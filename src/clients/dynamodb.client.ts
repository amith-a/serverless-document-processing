import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export function createDynamoDbClient(
  client?: DynamoDBClient,
): DynamoDBDocumentClient {
  const dynamoClient = client ?? new DynamoDBClient({});
  return DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}
