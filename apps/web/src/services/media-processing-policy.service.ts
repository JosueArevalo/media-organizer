export type MediaProcessingPolicy = {
  jpeg: 'compress' | 'copy';
  heic: 'convert' | 'copy';
  video: 'compress' | 'copy';
};

export type MediaProcessingRequirements = {
  jpegCount: number;
  heicCount: number;
  videoCount: number;
  mozJpegReady: boolean;
  imageMagickReady: boolean;
  handBrakeReady: boolean;
  jpegCopyAccepted?: boolean;
  heicCopyAccepted?: boolean;
  videoCopyAccepted?: boolean;
};

export const resolveMediaProcessingPolicy = (input: MediaProcessingRequirements) => {
  const jpegNeedsDecision = input.jpegCount > 0 && !input.mozJpegReady;
  const heicNeedsDecision = input.heicCount > 0 && (!input.mozJpegReady || !input.imageMagickReady);
  const videoNeedsDecision = input.videoCount > 0 && !input.handBrakeReady;
  const policy: MediaProcessingPolicy = {
    jpeg: input.mozJpegReady ? 'compress' : 'copy',
    heic: input.mozJpegReady && input.imageMagickReady ? 'convert' : 'copy',
    video: input.handBrakeReady ? 'compress' : 'copy'
  };

  return {
    policy,
    jpegNeedsDecision,
    heicNeedsDecision,
    videoNeedsDecision,
    fallbacksResolved:
      (!jpegNeedsDecision || Boolean(input.jpegCopyAccepted)) &&
      (!heicNeedsDecision || Boolean(input.heicCopyAccepted)) &&
      (!videoNeedsDecision || Boolean(input.videoCopyAccepted))
  };
};
