import os
import json
import uuid
import boto3
from botocore.exceptions import ClientError

ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

s3_client = boto3.client('s3')
BUCKET_NAME = os.getenv('BUCKET_NAME')


def lambda_handler(event, context):
    """Generate a pre-signed PUT URL for direct upload to S3.
    Accepts:
    {
        "filename": "my_report.pdf",
        "contentType" / "content_type": "application/pdf",
        "size": 5242880
    }
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': _cors_headers(),
            'body': ''
        }

    try:
        body = json.loads(event.get('body') or '{}')
        filename = body.get('filename', '').strip()
        content_type = body.get('contentType') or body.get('content_type', '').strip()
        size = int(body.get('size', 0))

        if not filename or not content_type:
            return {
                'statusCode': 400,
                'headers': _cors_headers(),
                'body': json.dumps({'error': 'Missing required fields: filename and contentType'})
            }

        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            return {
                'statusCode': 400,
                'headers': _cors_headers(),
                'body': json.dumps({'error': f'Unsupported file extension: {ext}. Allowed: .pdf, .jpg, .jpeg, .png'})
            }

        if size > MAX_FILE_SIZE:
            return {
                'statusCode': 400,
                'headers': _cors_headers(),
                'body': json.dumps({'error': f'File size exceeds limit of {MAX_FILE_SIZE // (1024 * 1024)} MB'})
            }

        # Normalize extension
        safe_ext = '.jpg' if ext == '.jpeg' else ext

        # Generate a clean 32-char hex report_id without slashes or spaces
        report_id = uuid.uuid4().hex
        s3_key = f"uploads/{report_id}{safe_ext}"

        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': s3_key,
                'ContentType': content_type
            },
            ExpiresIn=3600,
            HttpMethod='PUT'
        )

        response_body = {
            'url': presigned_url,
            'uploadUrl': presigned_url,
            'report_id': report_id,
            'reportId': report_id,
            'key': s3_key,
            'expires_in': 3600
        }

        return {
            'statusCode': 200,
            'headers': _cors_headers(),
            'body': json.dumps(response_body)
        }

    except (ValueError, json.JSONDecodeError) as e:
        return {
            'statusCode': 400,
            'headers': _cors_headers(),
            'body': json.dumps({'error': f'Invalid request: {str(e)}'})
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'headers': _cors_headers(),
            'body': json.dumps({'error': 'S3 error', 'details': e.response['Error']['Message']})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': _cors_headers(),
            'body': json.dumps({'error': 'Internal server error', 'details': str(e)})
        }


def _cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'
    }
