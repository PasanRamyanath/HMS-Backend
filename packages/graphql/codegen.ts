import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "schema.graphql",
  generates: {
    "src/generated/types.ts": {
      plugins: ["typescript"],
      config: {
        strictScalars: true,
        scalars: {
          AWSDate: "string",
          AWSTime: "string",
          AWSDateTime: "string",
          AWSTimestamp: "number",
          AWSEmail: "string",
          AWSJSON: "string",
          AWSURL: "string",
          AWSPhone: "string",
          AWSIPAddress: "string",
        },
        avoidOptionals: {
          field: true,
          inputValue: false,
          object: false,
          defaultValue: false,
        },
        enumsAsTypes: false,
        immutableTypes: false,
        useIndexSignature: true,
      },
    },
  },
};

export default config;
