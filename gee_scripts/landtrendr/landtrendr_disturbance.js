// FILE:       landtrendr_disturbance.js
// PURPOSE:    LandTrendr temporal segmentation for the Dabaoshan mine area
//             using the emaprlab LandTrendr GEE module. Detects disturbance
//             from Landsat NBR time series and exports YOD / MAG / DUR /
//             MPY rasters for the downstream ecosystem-service pipeline.
// PERIOD:     2009-2024 (NBR time series), disturbance window adjustable.
// INPUTS:     AOI: projects/ee-skyscanding/assets/Final_Reprojected_zxy
// OUTPUTS:    Four GeoTIFFs to Drive:
//               yod_{start}_{end}.tif      Year of Detection (int16)
//               mag_NBR_{start}_{end}.tif  NBR Magnitude (float32)
//               durReclass_{start}_{end}.tif Duration reclassified (int16)
//               mag_per_year_{start}_{end}.tif Magnitude per Year (float32)
// DEPENDENCY: users/emaprlab/public:Modules/LandTrendr.js
// PARAMETERS: Max Segments=6, MAG>200, DUR<5, Preval>300, MMU>11
// SCALE:      30 m, CRS EPSG:32649

// Study area
var roi = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy");
Map.centerObject(roi, 13);
Map.addLayer(roi, {color: 'yellow'}, 'Study Area');

// Analysis year range
var startYear = 2009;
var endYear   = 2024;

var startFilter = startYear + '-01-01';
var endFilter   = endYear   + '-01-01';  // exclusive end date

// LandTrendr parameters
var runParams = {
  maxSegments:            6,
  spikeThreshold:         0.9,
  vertexCountOvershoot:   3,
  preventOneYearRecovery: true,
  recoveryThreshold:      0.25,
  pvalThreshold:          0.05,
  bestModelProportion:    0.75,
  minObservationsNeeded:  6
};

// Change detection parameters
var changeParams = {
  delta:  'loss',
  sort:   'greatest',
  year:   {checked: true, start: startYear, end: endYear},
  mag:    {checked: true, value: 200,  operator: '>'},
  dur:    {checked: true, value: 5,    operator: '<'},
  preval: {checked: true, value: 300,  operator: '>'},
  mmu:    {checked: true, value: 11},
  index:  'NBR'
};

// Load the emaprlab LandTrendr module
var ltgee = require('users/emaprlab/public:Modules/LandTrendr.js');

// Band renaming and cloud masking functions

// Landsat 8 and 9 band rename
function bandRenameL89(image) {
  return image.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'])
              .rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2']);
}

// Landsat 5 and 7 band rename
function bandRenameL57(image) {
  return image.select(['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'])
              .rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2']);
}

// Apply Landsat SR scaling factors
function applyScaleFactors(image) {
  return image.addBands(
    image.select('SR_B.*').multiply(0.0000275).add(-0.2),
    null,
    true
  );
}

// Cloud mask for Landsat 5 and 7
function cloudMask57(image) {
  image = ee.Image(image);

  // QA mask: first 5 bits must be 0
  var qaMask = ee.Image(image).select('QA_PIXEL')
    .bitwiseAnd(parseInt('11111', 2)).eq(0);

  // Radiometric saturation mask
  var satMask = ee.Image(image).select('QA_RADSAT').eq(0);

  // Optical bands: scale + rename
  var optical = ee.Image(image).select([
      'SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'
    ])
    .multiply(0.0000275).add(-0.2)
    .rename(['blue','green','red','nir','swir1','swir2']);

  // Thermal band: scale + rename
  var thermal = ee.Image(image).select('ST_B6')
    .multiply(0.00341802).add(149.0)
    .rename('thermal');

  var combined = ee.Image(image)
    .addBands(optical)
    .addBands(thermal)
    .updateMask(qaMask)
    .updateMask(satMask)
    .copyProperties(image, ['system:time_start']);

  return ee.Image(combined).select([
    'blue','green','red','nir','swir1','swir2','thermal'
  ]);
}

// Cloud mask for Landsat 8 (and 9)
function cloudMask8(image) {
  image = ee.Image(image);

  // QA mask
  var qaMask = image.select('QA_PIXEL')
    .bitwiseAnd(parseInt('11111', 2)).eq(0);
  // Radiometric saturation mask
  var satMask = image.select('QA_RADSAT').eq(0);

  // Optical bands: scale + rename
  var optical = image.select([
      'SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'
    ])
    .multiply(0.0000275).add(-0.2)
    .rename(['blue','green','red','nir','swir1','swir2']);

  // Thermal band: scale + rename
  var thermal = image.select('ST_B10')
    .multiply(0.00341802).add(149.0)
    .rename('thermal');

  // Combine bands
  var withBands = ee.Image(image)
    .addBands(optical)
    .addBands(thermal);

  // Apply masks
  var masked = withBands
    .updateMask(qaMask)
    .updateMask(satMask);

  // Copy properties
  var copied = masked.copyProperties(image, ['system:time_start']);

  var result = ee.Image(copied).select([
    'blue','green','red','nir','swir1','swir2','thermal'
  ]);
  return result;
}

// Apply cloudMask57 to L5/L7 SR collection for the analysis window
var collection57 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterDate(startFilter, endFilter)
    .map(cloudMask57);

// Apply cloudMask8 to L8 SR collection
var collection8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterDate(startFilter, endFilter)
    .map(cloudMask8);

var composite8 = collection8.median();

// Preview composite
Map.setCenter(-4.52, 40.29, 7);
Map.addLayer(
  composite8,
  {bands: ['red','green','blue'], min: 0, max: 0.3},
  'L8 SR Composite'
);

// Return last day of month (ignores leap year for Feb)
function getMonthEndDay(m) {
  if (m === 2) {
    return 28;
  } else if ([4, 6, 9, 11].indexOf(m) !== -1) {
    return 30;
  } else {
    return 31;
  }
}

// Full-year date range
var startDate = '01-01';
var endDate   = '12-31';

// Run LandTrendr via the emaprlab module
var lt = ltgee.runLT(
  startYear,
  endYear,
  startDate,
  endDate,
  roi,
  'NBR',
  [],            // FTV list (usually empty)
  runParams,
  ['cloud','shadow','snow','water']  // mask types
);

// Get change map
var changeImg = ltgee.getChangeMap(lt, changeParams).clip(roi);

// Recover MAG to NBR units (LandTrendr outputs MAG x 1000 as integer)
var magNBR = changeImg.select('mag').multiply(0.001).rename('magNBR');

// Compute magnitude per year (avoid division by zero)
var magPerYear = magNBR.divide(changeImg.select('dur').max(1)).rename('mag_per_year');

// Reclassify duration: 1 year, 2 years, >=3 years (0 = no disturbance)
var durReclass = changeImg.select('dur').expression(
  "((d >= 3) ? 3 : ((d >= 2) ? 2 : ((d >= 1) ? 1 : 0)))",
  {d: changeImg.select('dur')}
).rename('durReclass');

// Visualize raw magnitude (LandTrendr scaled integer)
Map.addLayer(
  changeImg.select(['mag']),
  {min: 200, max: 800, palette: ['#9400D3','#4B0082','#0000FF','#00FF00','#FFFF00','#FF7F00','#FF0000']},
  'Magnitude'
);

// Visualize recovered NBR magnitude
Map.addLayer(
  magNBR,
  {min: 0, max: 0.8, palette: ['white','red']},
  'Mag in NBR'
);

// Visualize magnitude per year (NBR/year)
Map.addLayer(
  magPerYear,
  {min: 0, max: 0.2, palette: ['white','purple']},
  'Mag per Year (NBR/year)'
);

// Visualize Year of Detection
Map.addLayer(
  changeImg.select(['yod']),
  {min: startYear, max: endYear, palette: ['blue','cyan','green','yellow','red']},
  'Year of Detection'
);

// Visualize original Duration
Map.addLayer(
  changeImg.select(['dur']),
  {min: 0, max: 10, palette: ['white','gray','black']},
  'Duration'
);

// Visualize reclassified Duration
Map.addLayer(
  durReclass,
  {min: 0, max: 3, palette: ['white','blue','green','red']},
  'Duration Reclass (1,2,>=3 years)'
);

// Export results

// Export NBR-recovered magnitude (float32)
Export.image.toDrive({
  image: magNBR.unmask(0).float(),
  description: 'mag_NBR_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});

// Export Year of Detection (int16)
Export.image.toDrive({
  image: changeImg.select('yod').unmask(0).short(),
  description: 'yod_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});

// Export reclassified duration (int16)
Export.image.toDrive({
  image: durReclass.unmask(0).short(),
  description: 'durReclass_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});

// Export magnitude per year (float32)
Export.image.toDrive({
  image: magPerYear.unmask(0).float(),
  description: 'mag_per_year_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});
