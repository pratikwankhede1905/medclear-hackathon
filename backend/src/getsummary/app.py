import os
import json
import logging
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.getenv('DDB_TABLE')
table = dynamodb.Table(TABLE_NAME)

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    """GET /summary/{report_id}
    Returns:
      200: Processing complete with summary, flags, and questions
      202: Processing still in progress
      404: Report not found
      500: Processing failed or server error
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': _cors_headers(),
            'body': ''
        }

    try:
        path_params = event.get('pathParameters') or {}
        report_id = path_params.get('report_id', '').strip()
    except Exception as e:
        logger.exception('Failed to parse path parameter')
        return {
            'statusCode': 400,
            'headers': _cors_headers(),
            'body': json.dumps({'error': 'Invalid report_id parameter'})
        }

    if not report_id:
        return {
            'statusCode': 400,
            'headers': _cors_headers(),
            'body': json.dumps({'error': 'Missing report_id in path'})
        }

    try:
        response = table.get_item(Key={'report_id': report_id})
        item = response.get('Item')

        # Fallback: if not found by clean report_id, check if stored as full key
        if not item and not report_id.startswith('uploads/'):
            fallback_resp = table.get_item(Key={'report_id': f"uploads/{report_id}"})
            item = fallback_resp.get('Item')

        if not item:
            return {
                'statusCode': 404,
                'headers': _cors_headers(),
                'body': json.dumps({'status': 'NOT_FOUND', 'error': 'Report not found or not yet registered'})
            }

        status = item.get('status', 'PROCESSING')

        if status == 'PROCESSING':
            return {
                'statusCode': 202,
                'headers': _cors_headers(),
                'body': json.dumps({
                    'status': 'PROCESSING',
                    'message': 'Report analysis in progress'
                })
            }

        if status == 'ERROR':
            return {
                'statusCode': 500,
                'headers': _cors_headers(),
                'body': json.dumps({
                    'status': 'ERROR',
                    'error': item.get('error_message', 'Failed to analyze report')
                })
            }

        # Format flags and questions as guaranteed JSON arrays
        flags = item.get('flags', [])
        if isinstance(flags, str):
            flags = [f.strip() for f in flags.splitlines() if f.strip()]

        questions = item.get('questions', [])
        if isinstance(questions, str):
            questions = [q.strip() for q in questions.splitlines() if q.strip()]

        return {
            'statusCode': 200,
            'headers': _cors_headers(),
            'body': json.dumps({
                'status': 'COMPLETE',
                'report_id': report_id,
                'summary': item.get('summary', ''),
                'flags': flags,
                'questions': questions,
                'created_at': item.get('created_at'),
                'processed_at': item.get('processed_at')
            })
        }

    except ClientError as e:
        logger.exception('DynamoDB client error')
        return {
            'statusCode': 500,
            'headers': _cors_headers(),
            'body': json.dumps({'error': 'Database error', 'details': e.response['Error']['Message']})
        }
    except Exception as e:
        logger.exception('Unexpected error in getSummary')
        return {
            'statusCode': 500,
            'headers': _cors_headers(),
            'body': json.dumps({'error': 'Internal server error', 'details': str(e)})
        }


def _cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,GET',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'
    }
