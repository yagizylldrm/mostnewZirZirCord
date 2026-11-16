import type { GifDTO } from '@zirzircord/shared';

/** A GIPHY GIF in the chat: plays the small MP4 when there is one (much lighter than the GIF). */
export function GifView({ gif }: { gif: GifDTO }) {
  const width = Math.min(300, gif.width);
  return (
    <div className="group/gif relative mt-1 max-w-full overflow-hidden rounded-lg bg-field" style={{ width, aspectRatio: `${gif.width} / ${gif.height}` }}>
      {gif.mp4Url ? (
        <video src={gif.mp4Url} poster={gif.previewUrl} autoPlay loop muted playsInline aria-label={gif.title || 'GIF'} className="size-full object-cover" />
      ) : (
        <img src={gif.url} alt={gif.title || 'GIF'} className="size-full object-cover" />
      )}
      <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1 text-[10px] font-bold tracking-wide text-white opacity-0 transition group-hover/gif:opacity-100">
        GIPHY
      </span>
    </div>
  );
}
