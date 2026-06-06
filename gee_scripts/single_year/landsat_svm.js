// FILE:       landsat_svm.js
// PURPOSE:    Single-year Landsat 7/8/9 SVM LULC classification (SR + TOA).
// SOURCE:     Originally `Landsat_SVM1.js`
// INPUTS:     - Training points: imported via training_samples.js
//             - AOI:             projects/ee-skyscanding/assets/Final_Reprojected_zxy
//             - Year:            hardcoded at `var year = 2014`
// OUTPUTS:    Up to 4 classified GeoTIFFs to Drive folder `Landsat_SVM_Classification`:
//               - {year}_Landsat7_SR_Classification_SVM_Advanced
//               - {year}_Landsat89_SR_Classification_SVM_Advanced
//               - {year}_Landsat7_TOA_Classification_SVM_Advanced
//               - {year}_Landsat89_TOA_Classification_SVM_Advanced
// MODEL:      libsvm, RBF kernel, gamma=1, cost=100
// BANDS:      Blue, Green, Red, NIR, SWIR1, SWIR2 + NDVI, EVI, NDWI, NDBI,
//             MNDWI, FVC (12 features total)
// SCALE:      30 m, CRS EPSG:32649

// 0) Basic setup and AOI
var cc = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy");
Map.addLayer(cc, {color: 'orange'}, 'AOI Boundary');
Map.centerObject(cc, 13);

var year = 2014;
var cloudThreshold = 20;
var startDate = ee.Date.fromYMD(year, 1, 1);

// Utility functions
function replaceMask(img, newimg, nodata) {
  var fill = ee.Image.constant(ee.List.repeat(nodata, img.bandNames().length()))
                  .rename(img.bandNames());
  img = img.unmask(fill);
  img = img.where(img.mask().not(), newimg);
  return img.updateMask(img.neq(nodata));
}

function addTimeBand(img) {
  var time = img.metadata('system:time_start').rename('time');
  return img.addBands(time);
}

// Spectral indices
function addAllIndices(image) {
  var ndvi = image.normalizedDifference(['NIR', 'Red']).rename('NDVI');
  var evi = image.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
      'NIR': image.select('NIR'), 'RED': image.select('Red'), 'BLUE': image.select('Blue')
    }).rename('EVI');
  var ndwi = image.normalizedDifference(['Green', 'NIR']).rename('NDWI');
  var ndbi = image.normalizedDifference(['SWIR1', 'NIR']).rename('NDBI');
  var mndwi = image.normalizedDifference(['Green', 'SWIR1']).rename('MNDWI');
  var fvc = ndvi.expression( 
    'clamp((ndvi - soil) / (veg - soil), 0, 1)', { 
      'ndvi': ndvi, 'soil': 0.2, 'veg': 0.8
    }).rename('FVC');
  return image.addBands([ndvi, evi, ndwi, ndbi, mndwi, fvc]);
}


// Class definitions
var water_lc = water.map(function(f){ return f.set('lc', 1); });
var builtUp_lc = builtUp.map(function(f){ return f.set('lc', 2); });
var unrestoredLand_lc = unrestoredLand.map(function(f){ return f.set('lc', 3); });
var restoring_lc = restoring.map(function(f){ return f.set('lc', 4); });
var stableVegetation_lc = stableVegetation.map(function(f){ return f.set('lc', 5); });

var classNames = water_lc
  .merge(builtUp_lc)
  .merge(unrestoredLand_lc)
  .merge(restoring_lc)
  .merge(stableVegetation_lc);
print('Total sample points (merged):', classNames.size());
print('Unique lc values and counts (merged):', classNames.aggregate_histogram('lc'));


// Cloud mask
// MODIFIED: unified cloud mask, relaxed cirrus restriction for L8/9
function cloudMask(image, sensor) { // sensor param distinguishes L7 vs L8/9 band names
// Extract key QA bits
var qa = image.select('QA_PIXEL');
var fill = qa.bitwiseAnd(1 << 0).neq(0); // Bit 0: Fill
var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0); // Bit 1: Dilated Cloud / Expanded Cloud
var cloud = qa.bitwiseAnd(1 << 3).neq(0); // Bit 3: Cloud
var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0); // Bit 4: Cloud Shadow
// Bit 2 (Cirrus for L8/9, Unused for L7) is now NOT explicitly used to mask out pixels.
// We only care that the above "bad" conditions are false.

var badConditions = fill.or(dilatedCloud).or(cloud).or(cloudShadow);
var qaMask = badConditions.not(); // Good pixels are those where badConditions are false

var opticalBands;
var thermalBand;

if (sensor === 'L7') {
opticalBands = image.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'])
.multiply(0.0000275).add(-0.2)
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select('ST_B6')
.multiply(0.00341802).add(149.0)
.rename('LST');
}else { // L8 or L9
opticalBands = image.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7']) // L8/9 use SR_B2 for Blue
.multiply(0.0000275).add(-0.2)
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select(['ST_B10']) // L8/9 use ST_B10 for Thermal
.multiply(0.00341802).add(149.0)
.rename('LST');
}var satMask = image.select('QA_RADSAT').eq(0); // Saturation mask for SR products

return image.addBands(opticalBands, null, true)
.addBands(thermalBand, null, true)
.updateMask(qaMask)
.updateMask(satMask) // Apply saturation mask
.select(['Blue','Green','Red','NIR','SWIR1','SWIR2','LST']);
}
// MODIFIED: TOA cloud mask, unified logic, relaxed cirrus for L8/9
function cloudMaskTOA(image, sensor) {
var qa = image.select('QA_PIXEL');
var fill = qa.bitwiseAnd(1 << 0).neq(0);
var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);
var cloud = qa.bitwiseAnd(1 << 3).neq(0);
var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0);
var badConditions = fill.or(dilatedCloud).or(cloud).or(cloudShadow);
var qaMask = badConditions.not();

var opticalBands;
var thermalBand;

if (sensor === 'L7') {
opticalBands = image.select(['B1','B2','B3','B4','B5','B7'])
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select('B6_VCID_2').rename('LST');
}else { // L8 or L9
opticalBands = image.select(['B2','B3','B4','B5','B6','B7']) // L8/9 TOA use B2 for Blue
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select(['B10']).rename('LST'); // L8/9 TOA use B10 for Thermal
}
return image.addBands(opticalBands, null, true)
.addBands(thermalBand, null, true)
.updateMask(qaMask)
.select(['Blue','Green','Red','NIR','SWIR1','SWIR2','LST']);
}

// MODIFIED: SR median composite (was mean)
function getLandsatSRImage(startDate, cloudThreshold, region) {
var nodata = -9999;
var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];
var L7_SR_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold)) // Use CLOUD_COVER_LAND for better scene filtering
.map(function(img){ return cloudMask(img, 'L7'); });
var L8_SR_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
.map(function(img){ return cloudMask(img, 'L8'); });
var L9_SR_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
.map(function(img){ return cloudMask(img, 'L9'); });
var L89_SR_col = L8_SR_col.merge(L9_SR_col);
var y = ee.Date(startDate).get('year');
var yearFilter = ee.Filter.calendarRange(y, y, 'year');
// MODIFIED: annualComposite function now uses median
function annualComposite(col, fillImg) {
var filteredForYear = col.filter(yearFilter);
var comp;

if (filteredForYear.size().gt(0).getInfo()) {
comp = filteredForYear.median().clip(region.geometry());
comp = comp.set('isDummy', false); // Mark as not dummy
print('SR median composite built for year ' + y.getInfo() + ', images used: ' + filteredForYear.size().getInfo());
}else {
comp = fillImg; // fillImg is already marked as dummy
print('Insufficient SR images for year ' + y.getInfo() + ', using dummy.');
}// Apply focal_median for smoothing
comp = ee.Image(comp); // Ensure it's an image
comp = comp.focal_median(1, 'circle', 'pixels', 3);
return comp.select(bandTemplate).set('isDummy', comp.get('isDummy'));
}var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
.rename(bandTemplate)
.clip(region.geometry())
.set('isDummy', true); // Mark as dummy
var L7_comp = annualComposite(L7_SR_col, dummy);
var L89_comp = annualComposite(L89_SR_col, dummy);
return ee.Dictionary({
'Landsat7_SR': L7_comp.set('year', y),
'Landsat89_SR': L89_comp.set('year', y)
});
}
function getLandsatTOAImage(startDate, cloudThreshold, region) {
var nodata = -9999;
var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];
var L7_TOA_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_TOA')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold)) // TOA might not have CLOUD_COVER_LAND, use CLOUD_COVER
.map(function(img){ return cloudMaskTOA(img, 'L7'); });
var L8_TOA_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
.map(function(img){ return cloudMaskTOA(img, 'L8'); });
var L9_TOA_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
.map(function(img){ return cloudMaskTOA(img, 'L9'); });
var L89_TOA_col = L8_TOA_col.merge(L9_TOA_col);
var y = ee.Date(startDate).get('year');
var yearFilter = ee.Filter.calendarRange(y, y, 'year');
// MODIFIED: annualComposite function now uses median (same as SR version)
function annualComposite(col, fillImg) {
var filteredForYear = col.filter(yearFilter);
var comp;

if (filteredForYear.size().gt(0).getInfo()) {
comp = filteredForYear.median().clip(region.geometry());
comp = comp.set('isDummy', false);
print('TOA median composite built for year ' + y.getInfo() + ', images used: ' + filteredForYear.size().getInfo());
}else {
comp = fillImg;
print('Insufficient TOA images for year ' + y.getInfo() + ', using dummy.');
}comp = ee.Image(comp);
comp = comp.focal_median(1, 'circle', 'pixels', 3);
return comp.select(bandTemplate).set('isDummy', comp.get('isDummy'));
}var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
.rename(bandTemplate).clip(region.geometry()).set('isDummy', true);
var L7_comp = annualComposite(L7_TOA_col, dummy);
var L89_comp = annualComposite(L89_TOA_col, dummy);
return ee.Dictionary({
'Landsat7_TOA': L7_comp.set('year', y),
'Landsat89_TOA': L89_comp.set('year', y)
});
}


// SVM section
function trainAndClassifySVM(imageWithBands, sensorIdentifier, bandsToClassify, trainingSamples, studyRegion) {
  // Check if trainingSamples is valid (FeatureCollection and non-empty)
  if (!trainingSamples || !(trainingSamples instanceof ee.FeatureCollection) || trainingSamples.size().eq(0).getInfo()) {
    print('Error (' + sensorIdentifier + '): no training samples, wrong type, or empty collection. Skipping classification.');
    return null;
  }
  // Check if imageWithBands is valid (Image and has bands)
  if (!imageWithBands || !(imageWithBands instanceof ee.Image) || imageWithBands.bandNames().size().eq(0).getInfo()) {
    print('Error (' + sensorIdentifier + '): input image is empty, wrong type, or has no bands. Skipping classification.');
    return null;
  }
  // Check if image is a dummy
  var isDummy = imageWithBands.get('isDummy');
  if (ee.Algorithms.IsEqual(isDummy, true).getInfo() || ee.Algorithms.IsEqual(isDummy, 1).getInfo()) {
    print('Skip (' + sensorIdentifier + '): input is a dummy image (isDummy is true).');
    return null;
  }

  var availableBands = imageWithBands.bandNames();
  var bandsToClassify_ee = ee.List(bandsToClassify);

  // Band check: ensure all requested classification bands exist in the image
  var presentBands = bandsToClassify_ee.filter(ee.Filter.inList('item', availableBands));
  if (presentBands.size().neq(bandsToClassify_ee.size()).getInfo()) {
    print('Error (' + sensorIdentifier + '): not all specified bands (' + bandsToClassify_ee.join(', ') +
          ') exist in the image. Available bands: ' + availableBands.join(', ') + '. Skipping.');
    return null;
  }
  
  print('Debug (' + sensorIdentifier + '): requested classification bands:', bandsToClassify_ee);
  print('Debug (' + sensorIdentifier + '): actual bands in image:', availableBands);

  // Sample from image using 'lc' property in trainingSamples
  var currentTrainingData = imageWithBands.select(bandsToClassify_ee) 
                                    .sampleRegions({
                                      collection: trainingSamples, 
                                      properties: ['lc'], 
                                      scale: 30,               
                                      tileScale: 4
                                    });
  
  // Filter out samples where the first classification band is null
  // (this may miss samples where only subsequent bands are null)
  currentTrainingData = currentTrainingData.filter(ee.Filter.neq(bandsToClassify_ee.get(0), null));
  // Also ensure 'lc' property exists and is not null
  currentTrainingData = currentTrainingData.filter(ee.Filter.neq('lc', null));


  print('currentTrainingData unique lc values and counts (after sampling):', currentTrainingData.aggregate_histogram('lc'));

  if (currentTrainingData.size().lt(10).getInfo()){ // Ensure enough samples
    print('Error (' + sensorIdentifier + '): fewer than 10 valid training samples after sampling. Count: ' + currentTrainingData.size().getInfo() + '. Skipping.');
    return null;
  }

  // Train/test split (allows overlap between the two sets)
  var trainingFraction = 0.8;
  var testingFraction = 0.4;

  var trainingPartition = currentTrainingData.randomColumn('random_split_train', 1)
                                     .filter(ee.Filter.lt('random_split_train', trainingFraction));
  var testingPartition = currentTrainingData.randomColumn('random_split_test', 2)
                                     .filter(ee.Filter.lt('random_split_test', testingFraction));

  print('Training partition size (' + sensorIdentifier + '):', trainingPartition.size());
  print('Testing partition size (' + sensorIdentifier + '):', testingPartition.size());

  if (trainingPartition.size().lt(1).getInfo() || testingPartition.size().lt(1).getInfo()) { // At least 1 sample needed
    print('Error (' + sensorIdentifier + '): training or testing partition empty after random split. Check sample data and split fractions.');
    return null;
  }

  // SVM parameters: kernel, gamma, cost, svm type, decision procedure
  // For regression, change svmType and uncomment terminationEpsilon
  var svmParameters = {
    kernelType: 'RBF',
    gamma: 1,
    cost: 100,
    svmType: 'C_SVC', // default classification type
    decisionProcedure: 'Voting', // default voting
    //terminationEpsilon: 0.01   // Uncomment for EPSILON_SVR regression type; C_SVC will error with this
                                // This parameter may be ignored for C_SVC.
  };

  var classifier = ee.Classifier.libsvm(svmParameters).train({
    features: trainingPartition,
    classProperty: 'lc', // property from geometryimports
    inputProperties: bandsToClassify
  });

  var classifiedImage = imageWithBands.select(bandsToClassify).classify(classifier).clip(studyRegion.geometry());

  var testResults = testingPartition.classify(classifier); // Accuracy assessment on test set
  var confusionMatrix = testResults.errorMatrix('lc', 'classification');

  print('testingPartition unique lc values and counts:', testingPartition.aggregate_histogram('lc'));
  print('testResults unique classification values and counts:', testResults.aggregate_histogram('classification')); 

  print('* ' + sensorIdentifier + ' Confusion Matrix:', confusionMatrix);
  print('* ' + sensorIdentifier + ' Overall Accuracy:', confusionMatrix.accuracy());
  print('* ' + sensorIdentifier + ' Kappa:', confusionMatrix.kappa());

  Map.addLayer(classifiedImage, {min:1, max:5, palette:['#FF8C00','#0000FF','#008000','#FFFF00','#800080']}, sensorIdentifier + ' Classification');
  return classifiedImage;
}

// Classification bands (including indices)
var classificationBands = ['Blue','Green','Red','NIR','SWIR1','SWIR2', 'NDVI','EVI','NDWI','NDBI','MNDWI','FVC'];


// LandsatClassify function: calls trainAndClassifySVM
function LandsatClassify(sensorNameKey,          // e.g. 'Landsat7_SR'
                         bandsForClassification, // 12-band list including indices
                         trainingSamplesFC,      // classNames
                         aoiRegion, 
                         landsatCompositesDict) {
  var imageToClassify = ee.Image(landsatCompositesDict.get(sensorNameKey));

  // Check if image from dict is valid
  if (!imageToClassify || imageToClassify.bandNames().size().eq(0).getInfo()) {
    print('Error: could not get valid image from dict or image has no bands: ' + sensorNameKey + '. Skipping.');
    return null;
  }
  
  // Check if image is dummy (based on isDummy property)
  var isDummy = imageToClassify.get('isDummy');
   if (ee.Algorithms.IsEqual(isDummy, true).getInfo() || ee.Algorithms.IsEqual(isDummy, 1).getInfo()) {
    print('Skip (' + sensorNameKey + '): input is dummy image (isDummy is true from composite).');
    return null;
  }

  var imageWithIndices = addAllIndices(imageToClassify.select(['Blue','Green','Red','NIR','SWIR1','SWIR2']));

  return trainAndClassifySVM(
    imageWithIndices,       // image with indices
    sensorNameKey,          // sensorIdentifier
    bandsForClassification, // global classificationBands
    trainingSamplesFC,      // classNames
    aoiRegion               // cc
  );
}


print('Generating ' + year + ' Landsat SR composites...');
var landsat_SR_Images_Dict = getLandsatSRImage(startDate, cloudThreshold, cc);
print(year + ' Landsat SR composites done.', landsat_SR_Images_Dict);

print('Generating ' + year + ' Landsat TOA composites...');
var landsat_TOA_Images_Dict = getLandsatTOAImage(startDate, cloudThreshold, cc);
print(year + ' Landsat TOA composites done.', landsat_TOA_Images_Dict);

// Classify
print('Classifying...');
var Landsat7_SR_class = LandsatClassify('Landsat7_SR', classificationBands, classNames, cc, landsat_SR_Images_Dict);
var Landsat89_SR_class = LandsatClassify('Landsat89_SR', classificationBands, classNames, cc, landsat_SR_Images_Dict);

var Landsat7_TOA_class = LandsatClassify('Landsat7_TOA', classificationBands, classNames, cc, landsat_TOA_Images_Dict);
var Landsat89_TOA_class = LandsatClassify('Landsat89_TOA', classificationBands, classNames, cc, landsat_TOA_Images_Dict);
print('Classification done.');

// Batch export classification results
var exportFolder = 'Landsat_SVM_Classification'; 
var yStr = year.toString();

var outputList = [
  {name: yStr + '_Landsat7_SR', image: Landsat7_SR_class},     
  {name: yStr + '_Landsat89_SR', image: Landsat89_SR_class},
  {name: yStr + '_Landsat7_TOA', image: Landsat7_TOA_class},
  {name: yStr + '_Landsat89_TOA', image: Landsat89_TOA_class}
];

outputList.forEach(function(entry) {
  var imageToExport = entry.image;
  var descriptionName = entry.name + '_Classification_SVM_Advanced'; 

  if (imageToExport) { // Ensure image exists before export
    print('Exporting: ', descriptionName);
    Export.image.toDrive({
      image: imageToExport.toByte(), // single-band integer for export
      description: descriptionName,
      fileNamePrefix: descriptionName,
      folder: exportFolder,
      region: cc.geometry(),
      scale: 30,
      crs: 'EPSG:32649',
      maxPixels: 1e13,
      fileFormat: 'GeoTIFF'
    });
  } else {
    print('Image ' + entry.name + ' is null, skipping export.');
  }
});