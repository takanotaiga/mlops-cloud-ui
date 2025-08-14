"use client";

import { S3Client, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

export type EnsureResult = "exists" | "created"

export async function ensureBucketExists(
  s3: S3Client,
  bucket: string,
  region?: string,
): Promise<EnsureResult> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return "exists";
  } catch (_err: any) {
    // Attempt to create the bucket if head failed
    try {
      const params: any = { Bucket: bucket };
      if (region && region !== "us-east-1") {
        params.CreateBucketConfiguration = { LocationConstraint: region };
      }
      await s3.send(new CreateBucketCommand(params));
      // Verify creation
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      return "created";
    } catch (e2: any) {
      const code = e2?.name || e2?.Code || e2?.code || "";
      if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") {
        return "exists";
      }
      throw e2;
    }
  }
}

