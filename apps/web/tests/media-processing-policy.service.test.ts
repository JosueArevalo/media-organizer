import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveMediaProcessingPolicy } from '../src/services/media-processing-policy.service';

test('copy-only image formats require no tool fallback decision', () => {
  const result = resolveMediaProcessingPolicy({
    jpegCount: 0,
    heicCount: 0,
    videoCount: 0,
    mozJpegReady: false,
    imageMagickReady: false,
    handBrakeReady: false
  });
  assert.equal(result.fallbacksResolved, true);
});

test('missing MozJPEG requires explicit JPEG and HEIC copy choices', () => {
  const pending = resolveMediaProcessingPolicy({
    jpegCount: 2,
    heicCount: 1,
    videoCount: 0,
    mozJpegReady: false,
    imageMagickReady: true,
    handBrakeReady: false
  });
  assert.deepEqual(pending.policy, { jpeg: 'copy', heic: 'copy', video: 'copy' });
  assert.equal(pending.fallbacksResolved, false);

  const accepted = resolveMediaProcessingPolicy({
    jpegCount: 2,
    heicCount: 1,
    videoCount: 0,
    mozJpegReady: false,
    imageMagickReady: true,
    handBrakeReady: false,
    jpegCopyAccepted: true,
    heicCopyAccepted: true
  });
  assert.equal(accepted.fallbacksResolved, true);
});

test('mixed sources compress available media and copy explicitly accepted video', () => {
  const result = resolveMediaProcessingPolicy({
    jpegCount: 3,
    heicCount: 1,
    videoCount: 2,
    mozJpegReady: true,
    imageMagickReady: true,
    handBrakeReady: false,
    videoCopyAccepted: true
  });
  assert.deepEqual(result.policy, { jpeg: 'compress', heic: 'convert', video: 'copy' });
  assert.equal(result.fallbacksResolved, true);
});
