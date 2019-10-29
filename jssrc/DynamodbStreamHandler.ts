import AWS = require('aws-sdk');

const lambda = new AWS.Lambda();
const converter = AWS.DynamoDB.Converter;

export const invoke = async (event: any, context: any) => {
  for (let rc of event.Records) {
    if (!rc.dynamodb.NewImage) {
      continue;
    }

    const newImage = converter.unmarshall(rc.dynamodb.NewImage);

    if (newImage.audio_todo === newImage.audio_done && newImage.video_todo === newImage.video_done) {
      await lambda.invoke({
        FunctionName: process.env.LAMBDA_MERGE_HANDLER!,
        Payload: JSON.stringify(newImage),
        InvocationType: 'Event',
      }).promise();
    }
  }
}