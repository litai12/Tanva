import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSeedance25OmniReferenceTaskType,
  resolveSeedanceBillingDurations,
} from "./seedance25TaskType.ts";

test("maps Seedance 2.5 explicit video modes to Ark task type hints", () => {
  assert.equal(
    resolveSeedance25OmniReferenceTaskType({
      seedanceModel: "seedance-2.5",
      seedanceMode: "video_editing",
      referenceVideoCount: 1,
    }),
    "edit",
  );
  assert.equal(
    resolveSeedance25OmniReferenceTaskType({
      seedanceModel: "doubao-seedance-2-5-260628",
      seedanceMode: "video_extend",
      referenceVideoCount: 1,
    }),
    "extend",
  );
  assert.equal(
    resolveSeedance25OmniReferenceTaskType({
      seedanceModel: "2.5",
      seedanceMode: "video_reference",
      referenceVideoCount: 1,
    }),
    "reference",
  );
});

test("only marks generic omni mode as reference when media is connected", () => {
  assert.equal(
    resolveSeedance25OmniReferenceTaskType({
      seedanceModel: "seedance-2.5",
      seedanceMode: "reference_images",
    }),
    undefined,
  );
  assert.equal(
    resolveSeedance25OmniReferenceTaskType({
      seedanceModel: "seedance-2.5",
      seedanceMode: "reference_images",
      referenceAudioCount: 1,
    }),
    "reference",
  );
});

test("does not add Seedance 2.5 task hints to other model versions", () => {
  assert.equal(
    resolveSeedance25OmniReferenceTaskType({
      seedanceModel: "seedance-2.0",
      seedanceMode: "reference_images",
      referenceImageCount: 1,
    }),
    undefined,
  );
});

test("prices Seedance editing and extension as input duration plus output duration", () => {
  assert.deepEqual(
    resolveSeedanceBillingDurations({
      taskType: "edit",
      requestedOutputDurationSec: 5,
      inputVideoDurationSec: 10,
    }),
    {
      outputDurationSec: 10,
      inputVideoDurationSec: 10,
      billingDurationSec: 20,
    },
  );
  assert.deepEqual(
    resolveSeedanceBillingDurations({
      taskType: "extend",
      requestedOutputDurationSec: 8,
      inputVideoDurationSec: 10,
    }),
    {
      outputDurationSec: 8,
      inputVideoDurationSec: 10,
      billingDurationSec: 18,
    },
  );
});
