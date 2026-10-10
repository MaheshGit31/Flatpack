// MediaStreamTrackProcessor is Chrome/Edge only and missing from lib.dom.
declare class MediaStreamTrackProcessor<T = VideoFrame> {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
  readonly readable: ReadableStream<T>;
}
interface Window {
  documentPictureInPicture?: { requestWindow(opts?: { width?: number; height?: number }): Promise<Window>; window: Window | null };
}
