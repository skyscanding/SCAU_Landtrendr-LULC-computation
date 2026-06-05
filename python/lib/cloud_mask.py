"""Cloud / shadow / saturation masking for Landsat & Sentinel-2.

Logic mirrors the JS `cloudMask` / `cloudMaskTOA` / Cloud Score+ blocks.
Cirrus (QA_PIXEL bit 2) is deliberately NOT masked, matching the existing
GEE behavior — change `MASK_CIRRUS = True` if you want stricter filtering.
"""
from __future__ import annotations

import ee

MASK_CIRRUS = False  # set True for stricter masking; default mirrors JS

# Bit indices into the Landsat C2 QA_PIXEL band
_BIT_FILL = 0
_BIT_DILATED_CLOUD = 1
_BIT_CIRRUS = 2
_BIT_CLOUD = 3
_BIT_CLOUD_SHADOW = 4


def _qa_mask(image: ee.Image) -> ee.Image:
    qa = image.select("QA_PIXEL")
    bad = (
        qa.bitwiseAnd(1 << _BIT_FILL).neq(0)
        .Or(qa.bitwiseAnd(1 << _BIT_DILATED_CLOUD).neq(0))
        .Or(qa.bitwiseAnd(1 << _BIT_CLOUD).neq(0))
        .Or(qa.bitwiseAnd(1 << _BIT_CLOUD_SHADOW).neq(0))
    )
    if MASK_CIRRUS:
        bad = bad.Or(qa.bitwiseAnd(1 << _BIT_CIRRUS).neq(0))
    return bad.Not()


def landsat_sr_mask(image: ee.Image, sensor: str) -> ee.Image:
    """Apply QA + saturation mask and rescale SR bands to reflectance.

    `sensor` is one of {'L7', 'L8', 'L9'}. L8 and L9 share band layouts.
    Returns image with bands: Blue, Green, Red, NIR, SWIR1, SWIR2, LST.
    """
    qa_mask = _qa_mask(image)
    sat_mask = image.select("QA_RADSAT").eq(0)

    if sensor == "L7":
        optical_in = ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"]
        thermal_in = "ST_B6"
    else:  # L8 or L9
        optical_in = ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"]
        thermal_in = "ST_B10"

    optical = (
        image.select(optical_in)
        .multiply(0.0000275)
        .add(-0.2)
        .rename(["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"])
    )
    thermal = (
        image.select(thermal_in)
        .multiply(0.00341802)
        .add(149.0)
        .rename("LST")
    )

    return (
        image.addBands(optical, None, True)
        .addBands(thermal, None, True)
        .updateMask(qa_mask)
        .updateMask(sat_mask)
        .select(["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2", "LST"])
    )


def landsat_toa_mask(image: ee.Image, sensor: str) -> ee.Image:
    """TOA equivalent of `landsat_sr_mask` — no rescaling, just band rename."""
    qa_mask = _qa_mask(image)

    if sensor == "L7":
        optical_in = ["B1", "B2", "B3", "B4", "B5", "B7"]
        thermal_in = "B6_VCID_2"
    else:
        optical_in = ["B2", "B3", "B4", "B5", "B6", "B7"]
        thermal_in = "B10"

    optical = image.select(optical_in).rename(
        ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"]
    )
    thermal = image.select(thermal_in).rename("LST")
    return (
        image.addBands(optical, None, True)
        .addBands(thermal, None, True)
        .updateMask(qa_mask)
        .select(["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2", "LST"])
    )


def sentinel2_csplus_mask(
    image: ee.Image,
    csplus_band: str = "cs_cdf",
    threshold: float = 0.30,
) -> ee.Image:
    """Sentinel-2 SR_HARMONIZED masked by Cloud Score+ and scaled to reflectance.

    Expects `image` to have been linked with the
    `GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED` collection beforehand so that
    the `csplus_band` is present. See `composites.sentinel2_annual_composite`.
    """
    masked = image.updateMask(image.select(csplus_band).gte(threshold))
    optical = (
        masked.select(["B2", "B3", "B4", "B8", "B11", "B12"])
        .multiply(0.0001)
        .rename(["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"])
    )
    return optical.copyProperties(image, ["system:time_start"])
