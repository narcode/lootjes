// The real store behind lists.mjs: one JSON object in S3.
// The ETag is S3's version marker for an object; If-Match makes a save conditional on it.

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

export function s3Store({ client, bucket, key }) {
  const target = { Bucket: bucket, Key: key };
  return {
    async load() {
      const res = await client.send(new GetObjectCommand(target));
      return { state: JSON.parse(await res.Body.transformToString()), etag: res.ETag };
    },

    async save(state, etag) {
      try {
        await client.send(new PutObjectCommand({
          ...target,
          Body: JSON.stringify(state),
          ContentType: "application/json",
          IfMatch: etag,
        }));
        return true;
      } catch (e) {
        // 412: someone saved first. 409: someone is saving right now. Both mean: try again.
        if ([409, 412].includes(e.$metadata?.httpStatusCode)) return false;
        throw e;
      }
    },
  };
}
