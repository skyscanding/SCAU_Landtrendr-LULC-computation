"""Spectral indices and GLCM texture features.

Mirrors the JS helpers `addAllIndices` and `addTextureFeatures` from
`gee_scripts/multi_year/lulc_multiyear_strict.js`.
"""
from __future__ import annotations

import ee


def add_all_indices(image: ee.Image) -> ee.Image:
    """Append NDVI, EVI, NDWI, NDBI, MNDWI, FVC to a 6-band optical image.

    Input image must already have the bands renamed to:
        Blue, Green, Red, NIR, SWIR1, SWIR2
    """
    ndvi = image.normalizedDifference(["NIR", "Red"]).rename("NDVI")
    evi = image.expression(
        "2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))",
        {
            "NIR": image.select("NIR"),
            "RED": image.select("Red"),
            "BLUE": image.select("Blue"),
        },
    ).rename("EVI")
    ndwi = image.normalizedDifference(["Green", "NIR"]).rename("NDWI")
    ndbi = image.normalizedDifference(["SWIR1", "NIR"]).rename("NDBI")
    mndwi = image.normalizedDifference(["Green", "SWIR1"]).rename("MNDWI")
    fvc = ndvi.expression(
        "clamp((ndvi - soil) / (veg - soil), 0, 1)",
        {"ndvi": ndvi, "soil": 0.2, "veg": 0.8},
    ).rename("FVC")
    return image.addBands([ndvi, evi, ndwi, ndbi, mndwi, fvc])


def add_texture_features(image: ee.Image, glcm_size: int = 3) -> ee.Image:
    """Append three GLCM texture features computed from NDVI: contrast,
    entropy, homogeneity. Mirrors the strict-pipeline implementation.
    """
    gray = image.select("NDVI").multiply(1000).toInt16()
    glcm = gray.glcmTexture(size=glcm_size)
    contrast = glcm.select("NDVI_contrast").rename("Texture_Contrast")
    entropy = glcm.select("NDVI_ent").rename("Texture_Entropy")
    homogeneity = glcm.select("NDVI_idm").rename("Texture_Homogeneity")
    return image.addBands([contrast, entropy, homogeneity])


# Convenient band lists matching the JS scripts
OPTICAL_BANDS = ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"]
INDEX_BANDS = ["NDVI", "EVI", "NDWI", "NDBI", "MNDWI", "FVC"]
TEXTURE_BANDS = ["Texture_Contrast", "Texture_Entropy", "Texture_Homogeneity"]

BANDS_BASIC = OPTICAL_BANDS + INDEX_BANDS                   # 12 (lenient)
BANDS_WITH_TEXTURE = OPTICAL_BANDS + INDEX_BANDS + TEXTURE_BANDS  # 15 (strict)
