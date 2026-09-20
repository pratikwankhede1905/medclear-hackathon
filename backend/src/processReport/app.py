import os
import re
import json
import logging
import urllib.parse
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError

s3 = boto3.client('s3')
ddb = boto3.resource('dynamodb')
textract = boto3.client('textract')
bedrock = boto3.client('bedrock-runtime')

BUCKET_NAME = os.getenv('BUCKET_NAME')
TABLE_NAME = os.getenv('DDB_TABLE')
BEDROCK_MODEL_ID = os.getenv('BEDROCK_MODEL_ID', 'anthropic.claude-3-haiku-20240307-v1:0')

table = ddb.Table(TABLE_NAME)

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    """Entry point for S3 ObjectCreated event.
    1. Downloads file from S3
    2. Runs Textract DetectDocumentText
    3. Prompts Bedrock (Claude 3 Haiku via Messages API)
    4. Parses results into 3 structured sections
    5. Saves to DynamoDB
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

    # Extract report_id from the key (e.g., uploads/<report_id>.pdf -> <report_id>)
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
        # Step 2: Extract text using Textract
        logger.info('Extracting text from s3://%s/%s', bucket, key)
        obj = s3.get_object(Bucket=bucket, Key=key)
        file_bytes = obj['Body'].read()

        textract_response = textract.detect_document_text(
            Document={'Bytes': file_bytes}
        )
        extracted_text = _extract_text(textract_response)
        logger.info('Extracted %d characters from document', len(extracted_text))

        if not extracted_text.strip():
            extracted_text = "No readable text detected in this document. Please verify the report image quality."

        # Step 3: Build prompt for Claude 3
        prompt = _build_prompt(extracted_text)

        # Step 4: Invoke Bedrock using the Anthropic Messages API
        bedrock_payload = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1500,
            "temperature": 0.2,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }

        logger.info('Invoking Bedrock model: %s', BEDROCK_MODEL_ID)
        bedrock_response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType='application/json',
            accept='application/json',
            body=json.dumps(bedrock_payload)
        )
        response_body = json.loads(bedrock_response['body'].read())

        # Anthropic Messages API response format: content: [{ type: "text", text: "..." }]
        raw_output = ""
        if 'content' in response_body and len(response_body['content']) > 0:
            raw_output = response_body['content'][0].get('text', '')
        elif 'completion' in response_body:
            raw_output = response_body.get('completion', '')

        logger.info('Bedrock response received (%d chars)', len(raw_output))

        # Step 5: Parse structured output
        summary, flags, questions = _parse_bedrock_output(raw_output)

        # Step 6: Store final structured results in DynamoDB
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
        logger.info('Report %s processed successfully', report_id)
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


def _build_prompt(text):
    clean_text = ' '.join(text.split())
    if len(clean_text) > 8000:
        clean_text = clean_text[:8000]

    return f"""You are MedClear, an empathetic AI medical report assistant designed for elderly patients and everyday individuals who do not have a medical background.

Analyze the medical report text below and respond with EXACTLY three labeled sections:

Summary:
Write a simple, reassuring, 3-sentence summary in plain everyday language explaining what this test/report was for and the overall takeaway.

Abnormal Values:
List each abnormal, high, low, or out-of-range value as a bullet point starting with "- ". Explain what each test measures in simple words. If all values are normal or none are mentioned, write "- None detected".

Doctor Questions:
Provide 3 practical, easy-to-understand questions the patient can ask their doctor at their next appointment. Start each with "- ".

Medical Report Text:
{clean_text}"""


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
