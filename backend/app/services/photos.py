"""Member-photo normalization (issue #137).

Every stored photo is re-encoded to one uniform format (WebP) with a bounded
longest edge, so uploads of arbitrary size and format come out small and
consistent. Re-encoding also drops all metadata — including EXIF GPS
coordinates — after baking in the EXIF orientation so portraits don't come
out sideways.
"""

from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

# Longest edge after resize; avatars render at ~150px, so this keeps plenty
# of headroom for detail views without storing multi-megapixel originals.
MAX_EDGE = 1024
WEBP_QUALITY = 85
EXT = ".webp"


class InvalidImageError(ValueError):
    """The bytes could not be decoded as an image."""


def optimize(content: bytes) -> bytes:
    """Re-encode an image as WebP, capped at MAX_EDGE on the longest side.

    Animated GIFs keep only their first frame. Raises InvalidImageError for
    undecodable input (including decompression bombs).
    """
    try:
        img = Image.open(BytesIO(content))
        img = ImageOps.exif_transpose(img)
        # Palette / grayscale-alpha / CMYK etc. → keep alpha only where the
        # source has it, so opaque JPEGs stay opaque.
        if img.mode not in ("RGB", "RGBA"):
            has_alpha = img.mode in ("LA", "PA") or "transparency" in img.info
            img = img.convert("RGBA" if has_alpha else "RGB")
        img.thumbnail((MAX_EDGE, MAX_EDGE))
        out = BytesIO()
        img.save(out, format="WEBP", quality=WEBP_QUALITY)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise InvalidImageError(str(exc)) from exc
    return out.getvalue()
