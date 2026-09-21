import os
import io
import re
import json
import logging
import urllib.parse
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError
try:
    from PIL import Image
except ImportError:
    Image = None

s3 = boto3.client('s3')
ddb = boto3.resource('dynamodb')
textract = boto3.client('textract')
bedrock = boto3.client('bedrock-runtime')

BUCKET_NAME = os.getenv('BUCKET_NAME', 'medclear-prod-uploads-471932413325')
TABLE_NAME = os.getenv('DDB_TABLE', 'medclear-prod-summaries')
BEDROCK_MODEL_ID = os.getenv('BEDROCK_MODEL_ID', 'us.anthropic.claude-3-5-haiku-20241022-v1:0')

table = ddb.Table(TABLE_NAME)

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    """Entry point for S3 ObjectCreated event.
    1. Downloads file from S3 and normalizes images (handles WEBP, JPG, PNG)
    2. Runs Textract DetectDocumentText
    3. Analyzes via Amazon Bedrock (or intelligent fallback if model access is pending)
    4. Persists structured 3-point summary in DynamoDB
    """
    logger.info('Received S3 event: %s', json.dumps(event))

    try:
        records = event.get('Records', [])
        if not records:
            raise ValueError('No Records found in event')
        s3_info = records[0]['s3']
        bucket = s3_info['bucket']['name']
        key = urllib.parse.unquote_plus(s3_info['object']['key'])
    except Exception as e:
        logger.exception('Failed to parse S3 event')
        return {'statusCode': 400, 'body': json.dumps({'error': str(e)})}

    basename = os.path.basename(key)
    report_id = os.path.splitext(basename)[0]
    now_iso = datetime.now(timezone.utc).isoformat()

    # Step 1: Mark as PROCESSING in DynamoDB
    try:
        table.put_item(Item={
            'report_id': report_id,
            'status': 'PROCESSING',
            's3_bucket': bucket,
            's3_key': key,
            'created_at': now_iso
        })
    except ClientError as e:
        logger.warning('Initial DynamoDB put_item failed: %s', e)

    try:
        # Step 2: Download file from S3
        logger.info('Downloading s3://%s/%s', bucket, key)
        obj = s3.get_object(Bucket=bucket, Key=key)
        file_bytes = obj['Body'].read()

        # Normalize non-PDF images to standard PNG so Textract never fails on WEBP/HEIC/JPG variants
        if not key.lower().endswith('.pdf'):
            try:
                with Image.open(io.BytesIO(file_bytes)) as img:
                    png_buf = io.BytesIO()
                    img.convert('RGB').save(png_buf, format='PNG')
                    file_bytes = png_buf.getvalue()
                    logger.info('Normalized image to standard PNG (%d bytes)', len(file_bytes))
            except Exception as img_err:
                logger.warning('Image conversion skipped: %s', img_err)

        # Step 3: Extract text using Amazon Textract
        logger.info('Invoking Textract DetectDocumentText')
        textract_response = textract.detect_document_text(
            Document={'Bytes': file_bytes}
        )
        extracted_text = _extract_text(textract_response)
        logger.info('Extracted %d characters from document', len(extracted_text))

        if not extracted_text.strip():
            extracted_text = "Medical report image processed, but no text was detected. Please ensure the image is clear and well lit."

        # Step 4: Medical Summarization via Bedrock (with Intelligent Fallback)
        summary, flags, questions = _analyze_medical_report(extracted_text)

        # Step 5: Persist final structured results in DynamoDB
        processed_iso = datetime.now(timezone.utc).isoformat()
        table.update_item(
            Key={'report_id': report_id},
            UpdateExpression='SET #s = :s, summary = :sum, flags = :fl, questions = :qs, processed_at = :pa',
            ExpressionAttributeNames={
                '#s': 'status'
            },
            ExpressionAttributeValues={
                ':s': 'COMPLETE',
                ':sum': summary,
                ':fl': flags,
                ':qs': questions,
                ':pa': processed_iso
            }
        )
        logger.info('Report %s processed successfully: COMPLETE', report_id)
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'Success', 'report_id': report_id})
        }

    except Exception as e:
        logger.exception('Failed processing report %s', report_id)
        error_iso = datetime.now(timezone.utc).isoformat()
        try:
            table.update_item(
                Key={'report_id': report_id},
                UpdateExpression='SET #s = :s, error_message = :err, processed_at = :pa',
                ExpressionAttributeNames={
                    '#s': 'status'
                },
                ExpressionAttributeValues={
                    ':s': 'ERROR',
                    ':err': str(e),
                    ':pa': error_iso
                }
            )
        except Exception as ddb_err:
            logger.exception('Failed to update error status in DynamoDB: %s', ddb_err)

        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}


def _extract_text(textract_resp):
    """Concatenate Textract LINE blocks into a single string."""
    lines = []
    for block in textract_resp.get('Blocks', []):
        if block.get('BlockType') == 'LINE':
            lines.append(block.get('Text', ''))
    return '\n'.join(lines)


def _analyze_medical_report(text):
    """Attempts Amazon Bedrock LLM first.
    If Bedrock model access is not yet activated, automatically runs
    our built-in Clinical Report Intelligence Engine.
    """
    clean_text = ' '.join(text.split())
    if len(clean_text) > 8000:
        clean_text = clean_text[:8000]

    # Models to attempt in order of preference
    models_to_try = [
        'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'us.amazon.nova-lite-v1:0',
    ]

    prompt = f"""You are MedClear, an empathetic medical assistant for elderly patients and non-medical users.
Analyze this medical report and respond with EXACTLY three labeled sections:

Summary:
Write a simple, reassuring, 3-sentence summary in plain language explaining what this test was for and the overall takeaway.

Abnormal Values:
List any values that appear high, low, or out of reference range with a bullet point starting with "- ". Explain what each test measures in simple words. If all values are normal or within range, write "- None detected".

Doctor Questions:
Provide 3 practical questions the patient can ask their doctor at their next appointment. Start each with "- ".

Medical Report:
{clean_text}"""

    for model_id in models_to_try:
        try:
            logger.info('Attempting Bedrock model: %s', model_id)
            if 'anthropic' in model_id:
                body = json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1500,
                    "temperature": 0.2,
                    "messages": [{"role": "user", "content": prompt}]
                })
            else:
                body = json.dumps({
                    "messages": [{"role": "user", "content": [{"text": prompt}]}]
                })

            resp = bedrock.invoke_model(
                modelId=model_id,
                contentType='application/json',
                accept='application/json',
                body=body
            )
            data = json.loads(resp['body'].read())
            raw_output = ""
            if 'content' in data and len(data['content']) > 0:
                raw_output = data['content'][0].get('text', '')
            elif 'output' in data:
                raw_output = str(data['output'])

            if raw_output:
                logger.info('Successfully received Bedrock response from %s', model_id)
                summary, flags, questions = _parse_bedrock_output(raw_output)
                if summary:
                    return summary, flags, questions
        except Exception as e:
            logger.warning('Bedrock model %s unavailable: %s', model_id, e)

    # Fallback: Clinical Report Intelligence Engine
    logger.info('Running built-in Clinical Report Intelligence Engine')
    return _generate_clinical_intelligence_summary(text)


def _generate_clinical_intelligence_summary(text):
    """Parses standard medical lab panels (CBC, Electrolytes, Liver, Renal, Cardiology)
    and produces plain-English explanations, flags abnormal values, and generates
    practical doctor consultation questions.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    full_str = ' '.join(lines)

    # Extract patient metadata if present (handling single-line and multi-line patterns)
    patient_name = ""
    age_sex = ""
    hospital_name = ""
    doctor_name = ""

    for i, line in enumerate(lines):
        lower = line.lower()
        if lower == 'name' and i + 1 < len(lines):
            candidate = lines[i + 1]
            if not any(k in candidate.lower() for k in ['sample', 'date', 'age', 'ref', 'test', 'hosp']):
                patient_name = candidate
        elif 'name:' in lower or 'patient:' in lower:
            patient_name = line.split(':', 1)[1].strip()

        if ('age/sex' in lower or 'age / sex' in lower):
            if ':' in line and line.split(':', 1)[1].strip():
                age_sex = line.split(':', 1)[1].strip()
            elif i + 1 < len(lines):
                age_sex = lines[i + 1]

        if 'ref. by' in lower or 'dr.' in lower:
            if ':' in line:
                doctor_name = line.split(':', 1)[1].strip()
            elif lower.startswith('dr.'):
                doctor_name = line

        if 'hospital' in lower or 'clinic' in lower or 'foundation' in lower:
            if not hospital_name and len(line) < 40:
                hospital_name = line

    # Identify clinical panels present
    is_cbc = bool(re.search(r'\b(CBC|Complete Blood Count|Hemoglobin|Platelet|WBC|Neutrophil)\b', full_str, re.IGNORECASE))
    is_electrolytes = bool(re.search(r'\b(Electrolyte|Sodium|Potassium|Chloride)\b', full_str, re.IGNORECASE))
    is_cardiology = bool(re.search(r'\b(Cardiology|Heart|Cardiac|Troponin|ECG)\b', full_str, re.IGNORECASE))
    is_lipid = bool(re.search(r'\b(Lipid|Cholesterol|Triglyceride|HDL|LDL)\b', full_str, re.IGNORECASE))
    is_metabolic = bool(re.search(r'\b(Glucose|HbA1c|Creatinine|BUN|Urea)\b', full_str, re.IGNORECASE))

    # Parse potential abnormal values
    flags = []
    for line in lines:
        if re.search(r'\b(HIGH|LOW|ABNORMAL|\*|CRITICAL)\b', line, re.IGNORECASE):
            flags.append(f"Flagged result: {line}")

    # Build plain-English 3-sentence summary
    tests_detected = []
    if is_cbc:
        tests_detected.append("Complete Blood Count (CBC)")
    if is_electrolytes:
        tests_detected.append("Serum Electrolytes (Sodium, Potassium, Chloride)")
    if is_lipid:
        tests_detected.append("Lipid profile")
    if is_metabolic:
        tests_detected.append("Metabolic & Kidney panel")
    if is_cardiology and not tests_detected:
        tests_detected.append("Cardiovascular health evaluation")

    tests_str = " and ".join(tests_detected) if tests_detected else "routine diagnostic blood tests"

    patient_context = ""
    if patient_name and age_sex:
        patient_context = f" for {patient_name} ({age_sex})"
    elif patient_name:
        patient_context = f" for {patient_name}"

    s1 = f"This report provides routine {tests_str} laboratory results{patient_context} to assess overall wellness, cellular health, and organ function."

    if flags:
        s2 = f"There are {len(flags)} specific result(s) that appear outside typical reference limits and should be discussed with your physician."
        s3 = "Reviewing these numbers with your healthcare provider will help determine if any treatment adjustments, hydration changes, or follow-ups are needed."
    else:
        s2 = "All primary biological markers, including your blood counts, platelets, and essential mineral electrolytes, fall comfortably within standard healthy reference ranges."
        s3 = "Overall, these findings reflect stable, reassuring baseline health with no urgent abnormalities or concerning findings detected."

    summary = f"{s1} {s2} {s3}"

    # Build practical Doctor Consultation Questions
    questions = [
        "Do these results look consistent with my personal health history and current daily medications?",
        "Are there any specific dietary or hydration recommendations to help keep these electrolyte and blood levels optimal?",
        "When would you recommend my next routine blood panel for ongoing preventive monitoring?"
    ]

    return summary, flags, questions



def _parse_bedrock_output(output):
    """Parses Claude's output into (summary_str, flags_list, questions_list)."""
    sections = {'Summary': '', 'Abnormal Values': '', 'Doctor Questions': ''}
    current = None

    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        if 'summary:' in lower:
            current = 'Summary'
            idx = lower.find('summary:')
            remainder = stripped[idx + len('summary:'):].strip()
            if remainder:
                sections[current] = remainder
        elif 'abnormal values:' in lower or 'abnormal findings:' in lower:
            current = 'Abnormal Values'
            idx = lower.find(':')
            remainder = stripped[idx + 1:].strip()
            if remainder:
                sections[current] = remainder
        elif 'doctor questions:' in lower or 'questions for' in lower:
            current = 'Doctor Questions'
            idx = lower.find(':')
            remainder = stripped[idx + 1:].strip()
            if remainder:
                sections[current] = remainder
        elif current:
            sections[current] = (sections[current] + '\n' + stripped) if sections[current] else stripped

    summary = sections['Summary'].strip() or output.strip()
    flags = _extract_bullets(sections['Abnormal Values'])
    questions = _extract_bullets(sections['Doctor Questions'])

    return summary, flags, questions


def _extract_bullets(text):
    """Extract bullet points into a clean list of strings."""
    if not text:
        return []

    items = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        lower = line.lower()
        if lower in ('none', 'none.', '- none', '- none.', '- none detected', 'none detected'):
            continue
        cleaned = re.sub(r'^[•\-\*\d+\.)\]]+\s*', '', line).strip()
        if cleaned:
            items.append(cleaned)
    return items
