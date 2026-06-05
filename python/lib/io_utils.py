"""Image export helpers — Drive batch export OR direct download to disk.

GEE doesn't stream arbitrary-sized rasters down to your machine in one
call; for AOI-sized exports (<= ~32 MB per request, ~10000 px per side)
you can use `getDownloadURL` for synchronous download. Anything bigger
goes through Drive via an Export.image.toDrive task — same as in the JS.
"""
from __future__ import annotations

from pathlib import Path
import io
import urllib.request
import zipfile

import ee


def export_image_to_drive(
    image: ee.Image,
    description: str,
    folder: str,
    region: ee.Geometry,
    *,
    scale: int = 30,
    crs: str = "EPSG:32649",
    file_format: str = "GeoTIFF",
    max_pixels: int = int(1e13),
) -> ee.batch.Task:
    """Fire a Drive export task and return the started Task object."""
    task = ee.batch.Export.image.toDrive(
        image=image,
        description=description,
        fileNamePrefix=description,
        folder=folder,
        region=region,
        scale=scale,
        crs=crs,
        maxPixels=max_pixels,
        fileFormat=file_format,
    )
    task.start()
    print(f"  → started Drive export task: {description} (id={task.id})")
    return task


def download_image_to_local(
    image: ee.Image,
    out_path: str | Path,
    region: ee.Geometry,
    *,
    scale: int = 30,
    crs: str = "EPSG:32649",
) -> Path:
    """Synchronously download a clipped image as GeoTIFF to local disk.

    NOTE: Subject to GEE's `getDownloadURL` size limits (request must
    return < 32 MiB). For the Dabaoshan AOI at 30 m, a single-band
    classification image fits comfortably; expect failures for very
    large AOIs or multi-band exports at high resolution. Fall back to
    `export_image_to_drive` in that case.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    url = image.getDownloadURL(
        {
            "scale": scale,
            "crs": crs,
            "region": region,
            "format": "GEO_TIFF",
        }
    )

    print(f"  → downloading {out_path.name} ...")
    with urllib.request.urlopen(url) as resp:
        data = resp.read()

    # getDownloadURL may return a zip-wrapped tif for multi-band; handle both
    if data[:2] == b"PK":  # zip magic
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            tif_name = next(n for n in zf.namelist() if n.lower().endswith(".tif"))
            with zf.open(tif_name) as src, open(out_path, "wb") as dst:
                dst.write(src.read())
    else:
        out_path.write_bytes(data)

    print(f"  ✔ saved → {out_path}")
    return out_path
