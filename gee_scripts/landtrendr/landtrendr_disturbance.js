// FILE:       landtrendr_disturbance.js
// PURPOSE:    GEE LandTrendr temporal segmentation for the Dabaoshan mine area.
//             Fits piecewise-linear NBR trajectories, detects disturbance,
//             and exports YOD / MAG / DUR / MPY rasters for the downstream
//             ecosystem-service pipeline.
// PERIOD:     2009-2024 (NBR time series), disturbance window 2013-2024.
// INPUTS:     AOI: projects/ee-skyscanding/assets/Final_Reprojected_zxy
// OUTPUTS:    Four GeoTIFFs to Drive folder `LandTrendr_export`:
//               yod_2009_2024.tif   (Year of Detection, int16)
//               mag_2009_2024.tif   (NBR Magnitude, float32)
//               dur_2009_2024.tif   (Duration, int16)
//               magperyear_2009_2024.tif (Magnitude per Year, float32)
// PARAMETERS: Max Segments=6, MAG>200, DUR<5, Preval>300, MMU>11
// SCALE:      30 m, CRS EPSG:32649

// AOI
var aoi = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy");
Map.addLayer(aoi, {color: 'orange'}, 'AOI');
Map.centerObject(aoi, 13);

// LandTrendr parameters (Dabaoshan / Nanling convention)
var ltParams = {
  maxSegments:            6,
  spikeThreshold:         0.9,
  vertexCountOvershoot:   3,
  preventOneYearRecovery: true,
  recoveryThreshold:      0.25,
  pvalThreshold:          0.05,
  bestModelProportion:    0.75,
  minObservationsNeeded:  6
};

// Disturbance filters
var magThreshold  = 200;   // NBR drop x 1000 (>200 = real disturbance)
var durThreshold  = 5;     // Max duration (years)
var prevalThreshold = 300; // Pre-disturbance NBR threshold
var mmu           = 11;    // Minimum mapping unit (pixels)

// Build annual NBR composites from Landsat SR, 2009-2024
function buildNBRCollection(aoi) {
  var years = ee.List.sequence(2009, 2024);

  var annualNBR = ee.ImageCollection.fromImages(
    years.map(function(y) {
      y = ee.Number(y);
      var start = ee.Date.fromYMD(y, 1, 1);
      var end   = ee.Date.fromYMD(y, 12, 31);

      // L5 (2009-2011), L7 (2009-2024), L8 (2013-2024), L9 (2021-2024)
      var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .filter(ee.Filter.lt('CLOUD_COVER_LAND', 30))
        .map(function(img) {
          return img.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'])
            .multiply(0.0000275).add(-0.2)
            .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
        });

      var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .filter(ee.Filter.lt('CLOUD_COVER_LAND', 30))
        .map(function(img) {
          return img.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'])
            .multiply(0.0000275).add(-0.2)
            .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
        });

      var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .filter(ee.Filter.lt('CLOUD_COVER_LAND', 30))
        .map(function(img) {
          return img.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
            .multiply(0.0000275).add(-0.2)
            .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
        });

      var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
        .filterBounds(aoi).filterDate(start, end)
        .filter(ee.Filter.lt('CLOUD_COVER_LAND', 30))
        .map(function(img) {
          return img.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
            .multiply(0.0000275).add(-0.2)
            .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
        });

      var merged = l5.merge(l7).merge(l8).merge(l9);
      var nbr = merged.median().normalizedDifference(['NIR', 'SWIR1'])
        .rename('NBR')
        .set('year', y)
        .set('system:time_start', start.millis());

      return nbr;
    })
  );

  return annualNBR;
}

print('Building NBR collection...');
var nbrCollection = buildNBRCollection(aoi);
print('NBR collection size:', nbrCollection.size());

// Run LandTrendr
print('Running LandTrendr...');
var ltResult = ee.Algorithms.TemporalSegmentation.LandTrendr({
  timeSeries: nbrCollection,
  maxSegments:            ltParams.maxSegments,
  spikeThreshold:         ltParams.spikeThreshold,
  vertexCountOvershoot:   ltParams.vertexCountOvershoot,
  preventOneYearRecovery: ltParams.preventOneYearRecovery,
  recoveryThreshold:      ltParams.recoveryThreshold,
  pvalThreshold:          ltParams.pvalThreshold,
  bestModelProportion:    ltParams.bestModelProportion,
  minObservationsNeeded:  ltParams.minObservationsNeeded
});

// Extract disturbance bands
var ltArray = ltResult.select(['LandTrendr']);
var yod  = ltArray.arraySlice(0, 3, 4).arrayProject([1]).arrayFlatten([['yod']]);
var mag  = ltArray.arraySlice(0, 4, 5).arrayProject([1]).arrayFlatten([['mag']]);
var dur  = ltArray.arraySlice(0, 5, 6).arrayProject([1]).arrayFlatten([['dur']]);
var preval = ltArray.arraySlice(0, 6, 7).arrayProject([1]).arrayFlatten([['preval']]);

// Mask: keep only disturbances meeting thresholds
var disturbanceMask = mag.gt(magThreshold)
  .and(dur.lt(durThreshold))
  .and(preval.gt(prevalThreshold));

// Apply MMU (minimum mapping unit)
var connected = yod.updateMask(disturbanceMask).connectedPixelCount(11, true);
disturbanceMask = disturbanceMask.and(connected.gte(mmu));

// Apply mask and clip
yod  = yod.updateMask(disturbanceMask).toInt16().clip(aoi.geometry());
mag  = mag.updateMask(disturbanceMask).toFloat().clip(aoi.geometry());
dur  = dur.updateMask(disturbanceMask).toInt16().clip(aoi.geometry());
var mpy = mag.divide(dur).rename('magperyear').toFloat().clip(aoi.geometry());

// Display
Map.addLayer(yod, {min:2013, max:2024, palette:['yellow','orange','red','darkred']}, 'YOD');
Map.addLayer(mag, {min:0.2, max:0.8, palette:['#f1c40f','#e67e22','#e74c3c','#8b0000']}, 'MAG');

// Export to Drive
var exportFolder = 'LandTrendr_export';

Export.image.toDrive({
  image: yod,
  description: 'yod_2009_2024',
  fileNamePrefix: 'yod_2009_2024',
  folder: exportFolder,
  region: aoi.geometry(),
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: mag,
  description: 'mag_2009_2024',
  fileNamePrefix: 'mag_2009_2024',
  folder: exportFolder,
  region: aoi.geometry(),
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: dur,
  description: 'dur_2009_2024',
  fileNamePrefix: 'dur_2009_2024',
  folder: exportFolder,
  region: aoi.geometry(),
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: mpy,
  description: 'magperyear_2009_2024',
  fileNamePrefix: 'magperyear_2009_2024',
  folder: exportFolder,
  region: aoi.geometry(),
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

print('LandTrendr complete. Check Tasks panel for export jobs.');
