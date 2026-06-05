"""Annual composite builders for Landsat 7/8/9 and Sentinel-2.

Mirrors the JS `getLandsatSRImage`, `getLandsatTOAImage`, and
`getSentinel2SRImage` functions. Each builder:
  1. Filters the source collection to the AOI and the target year.
  2. Filters by scene-level cloud cover percent.
  3. Applies the appropriate cloud mask (`lib.cloud_mask`).
  4. Reduces with median (per-pixel).
  5. Applies a light focal_median smoother (kernel radius = 1 px).
  6. Falls back to a dummy nodata image if no scenes pass the filters.
"""
from __future__ import annotations

import ee

from .cloud_mask import landsat_sr_mask, landsat_toa_mask, sentinel2_csplus_mask

NODATA = -9999
BAND_TEMPLATE = ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2", "LST"]


def _dummy(region: ee.FeatureCollection, n_bands: int = 7) -> ee.Image:
    return (
        ee.Image.constant(ee.List.repeat(NODATA, n_bands))
        .rename(BAND_TEMPLATE[:n_bands])
        .clip(region.geometry())
        .set("isDummy", True)
    )


def _annual_composite(
    col: ee.ImageCollection,
    year: int,
    region: ee.FeatureCollection,
    bands: list[str] = None,
) -> ee.Image:
    bands = bands or BAND_TEMPLATE
    year_filter = ee.Filter.calendarRange(year, year, "year")
    filtered = col.filter(year_filter)
    comp = ee.Image(
        ee.Algorithms.If(
            filtered.size().gt(0),
            filtered.median().clip(region.geometry()).set("isDummy", False),
            _dummy(region, len(bands)),
        )
    )
    comp = comp.focal_median(1, "circle", "pixels", 1)
    return comp.select(bands)


def landsat_sr_annual_composite(
    year: int,
    cloud_threshold: int,
    region: ee.FeatureCollection,
) -> dict:
    """Return a dict like `{'Landsat7_SR': img, 'Landsat89_SR': img}`.

    L8/L9 collections are only queried for year >= 2013.
    """
    l7 = (
        ee.ImageCollection("LANDSAT/LE07/C02/T1_L2")
        .filterBounds(region)
        .filter(ee.Filter.lt("CLOUD_COVER_LAND", cloud_threshold))
        .map(lambda img: landsat_sr_mask(img, "L7"))
    )
    result = {"Landsat7_SR": _annual_composite(l7, year, region)}

    if year >= 2013:
        l8 = (
            ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
            .filterBounds(region)
            .filter(ee.Filter.lt("CLOUD_COVER_LAND", cloud_threshold))
            .map(lambda img: landsat_sr_mask(img, "L8"))
        )
        l9 = (
            ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
            .filterBounds(region)
            .filter(ee.Filter.lt("CLOUD_COVER_LAND", cloud_threshold))
            .map(lambda img: landsat_sr_mask(img, "L9"))
        )
        result["Landsat89_SR"] = _annual_composite(l8.merge(l9), year, region)
    return result


def landsat_toa_annual_composite(
    year: int,
    cloud_threshold: int,
    region: ee.FeatureCollection,
) -> dict:
    """Same shape as the SR builder, for TOA reflectance collections."""
    l7 = (
        ee.ImageCollection("LANDSAT/LE07/C02/T1_TOA")
        .filterBounds(region)
        .filter(ee.Filter.lt("CLOUD_COVER", cloud_threshold))
        .map(lambda img: landsat_toa_mask(img, "L7"))
    )
    result = {"Landsat7_TOA": _annual_composite(l7, year, region)}

    if year >= 2013:
        l8 = (
            ee.ImageCollection("LANDSAT/LC08/C02/T1_TOA")
            .filterBounds(region)
            .filter(ee.Filter.lt("CLOUD_COVER", cloud_threshold))
            .map(lambda img: landsat_toa_mask(img, "L8"))
        )
        l9 = (
            ee.ImageCollection("LANDSAT/LC09/C02/T1_TOA")
            .filterBounds(region)
            .filter(ee.Filter.lt("CLOUD_COVER", cloud_threshold))
            .map(lambda img: landsat_toa_mask(img, "L9"))
        )
        result["Landsat89_TOA"] = _annual_composite(l8.merge(l9), year, region)
    return result


def sentinel2_annual_composite(
    year: int,
    region: ee.FeatureCollection,
    csplus_threshold: float = 0.30,
    csplus_band: str = "cs_cdf",
) -> ee.Image:
    """Sentinel-2 SR median composite, masked by Cloud Score+."""
    year_filter = ee.Filter.calendarRange(year, year, "year")
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(region)
        .filter(year_filter)
    )
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    s2_linked = s2.linkCollection(cs, [csplus_band]).map(
        lambda img: sentinel2_csplus_mask(img, csplus_band, csplus_threshold)
    )

    optical_bands = ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"]
    return ee.Image(
        ee.Algorithms.If(
            s2_linked.size().gt(0),
            s2_linked.median().clip(region.geometry()).set("isDummy", False),
            ee.Image.constant(ee.List.repeat(NODATA, 6))
            .rename(optical_bands)
            .clip(region.geometry())
            .set("isDummy", True),
        )
    ).select(optical_bands)
