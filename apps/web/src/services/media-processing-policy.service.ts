export type MediaProcessingPolicy = {
  jpeg: 'compress' | 'copy';
  png: 'compress' | 'copy';
  heic: 'convert' | 'copy';
  video: 'compress' | 'copy';
};

export type MediaProcessingRequirements = {
  jpegCount: number;
  pngCount: number;
  heicCount: number;
  videoCount: number;
  mozJpegReady: boolean;
  pngQuantReady: boolean;
  imageMagickReady: boolean;
  handBrakeReady: boolean;
  jpegCopyAccepted?: boolean;
  pngCopyAccepted?: boolean;
  heicCopyAccepted?: boolean;
  videoCopyAccepted?: boolean;
};

export const resolveMediaProcessingPolicy = (input: MediaProcessingRequirements) => {
  const jpegNeedsDecision = input.jpegCount > 0 && !input.mozJpegReady;
  const pngNeedsDecision = input.pngCount > 0 && !input.pngQuantReady;
  const heicNeedsDecision = input.heicCount > 0 && (!input.mozJpegReady || !input.imageMagickReady);
  const videoNeedsDecision = input.videoCount > 0 && !input.handBrakeReady;
  const policy: MediaProcessingPolicy = {
    jpeg: input.mozJpegReady ? 'compress' : 'copy',
    png: input.pngQuantReady ? 'compress' : 'copy',
    heic: input.mozJpegReady && input.imageMagickReady ? 'convert' : 'copy',
    video: input.handBrakeReady ? 'compress' : 'copy'
  };

  return {
    policy,
    jpegNeedsDecision,
    pngNeedsDecision,
    heicNeedsDecision,
    videoNeedsDecision,
    fallbacksResolved:
      (!jpegNeedsDecision || Boolean(input.jpegCopyAccepted)) &&
      (!pngNeedsDecision || Boolean(input.pngCopyAccepted)) &&
      (!heicNeedsDecision || Boolean(input.heicCopyAccepted)) &&
      (!videoNeedsDecision || Boolean(input.videoCopyAccepted))
  };
};
