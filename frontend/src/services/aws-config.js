import { Amplify } from "aws-amplify";

Amplify.configure({
  Auth: {
    // Replace these with your SAM stack outputs
    region: import.meta.env.VITE_AWS_REGION || "us-east-1",
    userPoolId: import.meta.env.VITE_USER_POOL_ID || "PLACEHOLDER_USER_POOL_ID",
    userPoolWebClientId:
      import.meta.env.VITE_USER_POOL_CLIENT_ID || "PLACEHOLDER_CLIENT_ID",
  },
  API: {
    endpoints: [
      {
        name: "MedClearAPI",
        endpoint:
          import.meta.env.VITE_API_ENDPOINT || "https://PLACEHOLDER.execute-api.us-east-1.amazonaws.com/Prod",
        region: import.meta.env.VITE_AWS_REGION || "us-east-1",
      },
    ],
  },
});

export const API_ENDPOINT =
  import.meta.env.VITE_API_ENDPOINT ||
  "https://PLACEHOLDER.execute-api.us-east-1.amazonaws.com/Prod";
