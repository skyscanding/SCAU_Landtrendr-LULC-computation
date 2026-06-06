// FILE:       sentinel2_svm.js
// PURPOSE:    Single-year Sentinel-2 SR SVM LULC classification using
//             Cloud Score+ for cloud masking.
// SOURCE:     Originally `Sentinel_SVM.js`
// INPUTS:     - Training points: imported via training_samples.js
//             - AOI:             projects/ee-skyscanding/assets/Final_Reprojected_zxy
//             - Year:            hardcoded at `var year = 2018`
// OUTPUTS:    1 classified GeoTIFF to Drive folder `Sentinel_SVM_Classification`:
//               - {year}_Sentinel2_SR_CSPlus_Classification_ZXY
// CLOUD MASK: COPERNICUS/S2_SR_HARMONIZED linked to GOOGLE/CLOUD_SCORE_PLUS;
//             keeps pixels with cs_cdf >= 0.30
// MODEL:      libsvm, RBF kernel, gamma=1, cost=100
// BANDS:      Blue, Green, Red, NIR, SWIR1, SWIR2 + NDVI, EVI, NDWI, NDBI,
//             MNDWI, FVC (12 features total)
// SCALE:      10 m, CRS EPSG:32649
// NOTE:       Contains a commented-out linear-fit gap-fill block (kept for
//             reference); current pipeline takes the unfilled median.

// AOI setup
var cc = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy"); 
Map.addLayer(cc, {color: 'red'}, 'AOI Boundary');
Map.centerObject(cc, 13);

var year = 2018;
//var cloudThreshold = 30;
var startDate = ee.Date.fromYMD(year, 1, 1);

// Cloud Score+ parameters
var CSPLUS_QA_BAND = 'cs_cdf';
var CSPLUS_CLEAR_THRESHOLD = 0.30;

// 1) Utilities
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

// 2) Spectral indices
var sentinelOpticalBands = ['Blue','Green','Red','NIR','SWIR1','SWIR2'];
var indexBands = ['NDVI', 'EVI', 'NDWI', 'NDBI', 'MNDWI', 'FVC'];
var outputBandsDefault = sentinelOpticalBands.concat(indexBands);

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

print('Unique lc values and counts in classNames:', classNames.aggregate_histogram('lc'));

// 3) Sentinel-2 SR annual median composite with Cloud Score+ masking
function getSentinel2SRImage(startDate, region, clearScoreThreshold, csPlusQaBand) {
  var targetYear = ee.Date(startDate).get('year');
  var yearFilter = ee.Filter.calendarRange(targetYear, targetYear, 'year');
  var nodata = -9999;

  var s2OutputBands = sentinelOpticalBands.concat(indexBands);

  var dummyImg = ee.Image.constant(ee.List.repeat(nodata, sentinelOpticalBands.length))
                      .rename(sentinelOpticalBands)
                      .clip(region.geometry());

  // Sentinel-2 SR collection
  var s2SR_collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                        .filterBounds(region);

  // Cloud Score+ collection
  var csPlus_collection = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

  // Filter S2 by year
  var s2SR_yearly = s2SR_collection.filter(yearFilter);
  print('Debug: raw S2 image count for year ' + targetYear.getInfo() + ' in AOI (before masking):', s2SR_yearly.size());

  // Link S2 with Cloud Score+, apply mask, scale, and rename
  var s2SR_col_processed = s2SR_yearly
    .linkCollection(csPlus_collection, [csPlusQaBand]) // link the two collections
    .map(function(img) {
      // Apply Cloud Score+ mask
      var maskedImg = img.updateMask(img.select(csPlusQaBand).gte(clearScoreThreshold));

      // Select, scale, and rename optical bands
      var opticalBandsScaled = maskedImg.select(['B2','B3','B4','B8','B11','B12'])
                                .multiply(0.0001) // scale to 0-1 reflectance
                                .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
      return opticalBandsScaled.copyProperties(img, ['system:time_start']);
    });

  // Execute linear fit and fill
function _executeLinearFitAndFill(imgToFill, bandsForFit, fillMedianImage, kernelToUse) {
  var fillSelected = fillMedianImage.select(bandsForFit);
  var imgSelected = imgToFill.select(bandsForFit);
  var paired = fillSelected.addBands(imgSelected);

  var fit = paired.reduceNeighborhood({
    reducer: ee.Reducer.linearFit().forEach(bandsForFit),
    kernel: kernelToUse,
    inputWeight: 'mask'
  });

  // Key check: ensure fit image contains all expected offset and scale bands
  var expectedOffsetBands = bandsForFit.map(function(b) { return ee.String(b).cat('_offset'); });
  var expectedScaleBands = bandsForFit.map(function(b) { return ee.String(b).cat('_scale'); });
  var allExpectedFitBands = ee.List(expectedOffsetBands).cat(expectedScaleBands);
  var actualFitBands = fit.bandNames();

  var allFitBandsGenerated = allExpectedFitBands.map(function(expectedName) {
    return actualFitBands.contains(expectedName);
  }).reduce(ee.Reducer.and()); // check if all expected bands exist

  // "true" branch logic (if fit generated all bands normally)
  // Using IIFE to directly return an ee.Image result
  var filledImageWhenFitGenerated = (function() {
    var offset = fit.select(expectedOffsetBands).rename(bandsForFit);
    var scaleFactor = fit.select(expectedScaleBands).rename(bandsForFit);
    var filledValues = fillSelected.multiply(scaleFactor).add(offset);
    return imgToFill.unmask(filledValues, true).select(imgToFill.bandNames());
  })(); // execute immediately

  return ee.Image(ee.Algorithms.If(
    allFitBandsGenerated,
    filledImageWhenFitGenerated, // pass GEE object directly
    // If fit failed to generate all bands (possible input data issue), return original image
    imgToFill
  ));
}
    // GapFill helper function
  /*var kernel = ee.Kernel.square(10 * 10, 'meters', false);

  function GapFill(img, collectionForFill) {
  var timeStartObj = img.get('system:time_start');

  // Logic when timeStartObj exists (entire result is an ee.Image)
  var filledImageWhenTimeExists = (function() {
    var imgDate = ee.Date(timeStartObj);
    var bandsToFit = ee.List(img.bandNames()).filter(ee.Filter.inList('item', sentinelOpticalBands));

    // Condition 2: must have optical bands to fill
    return ee.Image(ee.Algorithms.If(
      bandsToFit.length().gt(0),
      // Condition 2 true: bandsToFit not empty
      (function() { // IIFE for Condition 2 true branch
        var start = imgDate.advance(-2, 'year');
        var end = imgDate.advance(2, 'year');
        var fillSourceCollection = collectionForFill.filterDate(start, end);

        // Condition 3: must have fill source images
        return ee.Image(ee.Algorithms.If(
          fillSourceCollection.size().gt(0),
          // Condition 3 true: fillSourceCollection not empty
          (function() { // IIFE for Condition 3 true branch
            var fillMedian = fillSourceCollection.median().select(sentinelOpticalBands);
            var commonBandsToUse = fillMedian.bandNames().filter(ee.Filter.inList('item', bandsToFit));

            // Condition 4: must have common bands for fitting
            return ee.Image(ee.Algorithms.If(
              commonBandsToUse.length().gt(0),
              // Condition 4 true: commonBandsToUse not empty, execute core fill
              _executeLinearFitAndFill(img, commonBandsToUse, fillMedian, kernel),
              // Condition 4 false: no common bands, return original
              img
            ));
          })(), // execute immediately
          // Condition 3 false: fillSourceCollection empty, return original
          img
        ));
      })(), // execute immediately
      // Condition 2 false: bandsToFit empty, return original
      img
    ));
  })(); // execute immediately

  // Server-side logic begins
  return ee.Image(ee.Algorithms.If(
    timeStartObj, // Condition 1: timeStartObj exists (GEE server-side object)
    filledImageWhenTimeExists, // if true, use above computed result
    // Condition 1 false: timeStartObj is null (server-side), return original
    img
  ));
}
  // GapFill function ends here
*/

  var s2_composite;
  if (s2SR_col_processed.size().gt(0).getInfo()) {
    print('s2SR_col_processed is not empty, image count:', s2SR_col_processed.size());

    var s2_col_gapfilled = s2SR_col_processed; // use unfilled collection directly
    var firstImage = ee.Image(s2_col_gapfilled.first());
    var bandsPresent = ee.Algorithms.If(
        s2_col_gapfilled.size().gt(0).and(firstImage.bandNames().size().gt(0)),
        true,
        false
    );

    s2_composite = ee.Image(ee.Algorithms.If(
      bandsPresent,
      s2_col_gapfilled.median().select(sentinelOpticalBands),
      dummyImg // use dummy if no data
    ));
    s2_composite = s2_composite.clip(region.geometry());
  } else {
    print('No Sentinel-2 images found in AOI for year ' + targetYear.getInfo() + '.');
    s2_composite = dummyImg;
  }

  s2_composite = addAllIndices(s2_composite).select(s2OutputBands);
  // Check whether s2_composite is dummy or still has valid bands after processing
  var isDummyCheck = ee.Algorithms.If(
      s2_composite.bandNames().size().gt(0).and(s2_composite.reduceRegion(ee.Reducer.max(), region.geometry(), 1000).values().get(0)),
      s2SR_col_processed.size().eq(0), // original isDummy logic
      true // also treat as dummy if no bands or values
  );
  s2_composite = s2_composite.set('isDummy', isDummyCheck);


  return ee.Dictionary({
    'Sentinel2_SR': s2_composite
  });
}


// 4) Sample balancing and image completeness check
function getBalancedSamples(imageWithBands, featureCollection, scale, refBandName) {
  var samples = imageWithBands.sampleRegions({
    collection: featureCollection, properties: ['lc'], scale: scale, geometries: true
  });
  samples = samples.filter(ee.Filter.neq(refBandName, -9999));
  print('Original sample count:', samples.size());
  var classValues = ee.List(samples.aggregate_array('lc')).distinct().sort();
  var balanced = ee.FeatureCollection(classValues.map(function(cls) {
    cls = ee.Number(cls);
    var classSamples = samples.filter(ee.Filter.eq('lc', cls));
    var count = classSamples.size();
    var desired = ee.Algorithms.If(count.gt(1500), 1500,
                  ee.Algorithms.If(count.lt(500), count, 500));
    return classSamples.randomColumn('rand').limit(ee.Number(desired), 'rand');
  }).flatten());
  print('Balanced sample count:', balanced.size());
  return balanced;
}

function isImageComplete(image, region, refBandName) {
   var maskStats = image.mask().select(refBandName).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: region.geometry(), scale: 10, maxPixels: 1e13
  });
  return ee.Number(maskStats.get(refBandName));
}

// 5) SVM section
function trainAndClassifySVM(imageWithBands, sensorIdentifier, bandsToClassify, trainingSamples, studyRegion) {
  if (!trainingSamples || trainingSamples.size().eq(0).getInfo()) {
    print('Error (' + sensorIdentifier + '): no training samples or empty collection. Skipping.');
    return null;
  }
  if (!imageWithBands || imageWithBands.bandNames().size().eq(0).getInfo()) {
     print('Error (' + sensorIdentifier + '): input image is empty or has no bands. Skipping.');
    return null;
  }
  if (imageWithBands.get('isDummy').getInfo()) {
    print('Skip (' + sensorIdentifier + '): input is a dummy image.');
    return null;
  }
  var availableBands = imageWithBands.bandNames(); // server-side ee.List
  var bandsToClassify_ee = ee.List(bandsToClassify);
  var nBandsRequired_check = bandsToClassify_ee.length();

  // Debug: print bandsToClassify_ee and availableBands
  print('Debug (' + sensorIdentifier + '): requested classification bands:', bandsToClassify_ee);
  print('Debug (' + sensorIdentifier + '): actual bands in image:', availableBands);

  // Map result for inspection
  var mappedContainsList_check = bandsToClassify_ee.map(function(bandName) {
    return availableBands.contains(ee.String(bandName)); // returns ee.Boolean (1 or 0)
  });
  print('Debug (' + sensorIdentifier + '): band presence map (1=present, 0=absent):', mappedContainsList_check);
  
  // Fixed nBandsPresent_check: filter and get size
  var presentBandsInList_check = bandsToClassify_ee.filter(
    ee.Filter.inList('item', availableBands)
  );
  var nBandsPresent_check = presentBandsInList_check.size();
  
  print('Debug (' + sensorIdentifier + '): filtered bands present in image:', presentBandsInList_check);
  print('Debug (' + sensorIdentifier + '): computed present band count:', nBandsPresent_check);
  print('Debug (' + sensorIdentifier + '): total required band count:', nBandsRequired_check);

  var allBandsPresent_server_check = ee.Algorithms.If(
    nBandsRequired_check.eq(0),
    ee.Number(1).eq(1), 
    nBandsPresent_check.eq(nBandsRequired_check)
  );

  print('Band check status (' + sensorIdentifier + '): all required bands present? ', allBandsPresent_server_check);

  // Note: getInfo() forces server-side computation; use carefully in loops or map.
  if (!allBandsPresent_server_check.getInfo()) { 
    print('Error (' + sensorIdentifier + '): not all specified bands exist in the image. Skipping.');
    print('Detail - available bands (' + sensorIdentifier + '): ', availableBands);
    print('Detail - requested bands (' + sensorIdentifier + '): ', bandsToClassify_ee);
    return null;
  }

  var currentTrainingData = imageWithBands.select(bandsToClassify).sampleRegions({
    collection: trainingSamples, properties: ['lc'], scale: 10, tileScale: 16
  });
  currentTrainingData = currentTrainingData.filter(ee.Filter.neq(ee.List(bandsToClassify).get(0), null));

  print('currentTrainingData unique lc values and counts:', currentTrainingData.aggregate_histogram('lc'));

  if (currentTrainingData.size().lt(10).getInfo()){
    print('Error (' + sensorIdentifier + '): fewer than 10 valid training samples after sampling. Count: ' + currentTrainingData.size().getInfo());
    return null;
  }

  // Train/test split (overlap allowed between sets)
  var trainingFraction = 0.8; // ~80% for training
  var testingFraction = 0.4;  // ~40% for testing (overlap with training allowed)

  // Add random column for training set and filter
  var trainingPartition = currentTrainingData.randomColumn('random_split_train', 1)
                                     .filter(ee.Filter.lt('random_split_train', trainingFraction));

  // Add random column for testing set and filter
  var testingPartition = currentTrainingData.randomColumn('random_split_test', 2)
                                     .filter(ee.Filter.lt('random_split_test', testingFraction));

  print('Training partition size (' + sensorIdentifier + '):', trainingPartition.size());
  print('Testing partition size (' + sensorIdentifier + '):', testingPartition.size());


  if (trainingPartition.size().eq(0).getInfo() || testingPartition.size().eq(0).getInfo()) {
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
    //terminationEpsilon: 0.01   // Uncomment for EPSILON_SVR; C_SVC will error with this
                                // May be ignored for C_SVC classification.
  };

  var classifier = ee.Classifier.libsvm(svmParameters).train({
    features: trainingPartition,
    classProperty: 'lc', // property from geometryimports
    inputProperties: bandsToClassify
  });

  var classifiedImage = imageWithBands.select(bandsToClassify).classify(classifier).clip(studyRegion.geometry());

  var testResults = testingPartition.classify(classifier); // accuracy assessment on test set
  var confusionMatrix = testResults.errorMatrix('lc', 'classification');

  print('testingPartition unique lc values and counts:', testingPartition.aggregate_histogram('lc'));
  print('testResults unique classification values and counts:', testResults.aggregate_histogram('classification')); 

  print('* ' + sensorIdentifier + ' Confusion Matrix:', confusionMatrix);
  print('* ' + sensorIdentifier + ' Overall Accuracy:', confusionMatrix.accuracy());
  print('* ' + sensorIdentifier + ' Kappa:', confusionMatrix.kappa());

  Map.addLayer(classifiedImage, {min:1, max:5, palette:['#FF8C00','#0000FF','#008000','#FFFF00','#800080']}, sensorIdentifier + ' Classification');
  return classifiedImage;
}

var classificationBands = ['Blue','Green','Red','NIR','SWIR1','SWIR2', 'NDVI','EVI','NDWI','NDBI','MNDWI','FVC'];

// 6) Main classification wrapper (Sentinel-2 adapter)
function performSentinel2Classification(sensorId, bandsForClf, trainingDataFc, studyAreaGeo, s2ImageDict) {
  var imageObject = s2ImageDict.get(sensorId);
  if (!imageObject) {
    print('Image is null: ' + sensorId);
    return null;
  }
  var image = ee.Image(imageObject);
  var imageBands = image.bandNames(); 
  var bandsForClf_ee = ee.List(bandsForClf);
  var nBandsRequired = bandsForClf_ee.length();

  // Fixed nBandsPresent: filter and get size
  var presentBandsInList = bandsForClf_ee.filter(
    ee.Filter.inList('item', imageBands)
  );
  var nBandsPresent = presentBandsInList.size();

  var allBandsPresent_server = ee.Algorithms.If(
    nBandsRequired.eq(0),
    ee.Number(1).eq(1), 
    nBandsPresent.eq(nBandsRequired)
  );

  if (!allBandsPresent_server.getInfo()) { 
    print('Cannot classify ' + sensorId + ': composite image missing required bands.');
    print('Detail - available bands (' + sensorId + '): ', imageBands);
    print('Detail - requested bands (' + sensorId + '): ', bandsForClf_ee);
    return null;
  }
  return trainAndClassifySVM(image, sensorId, bandsForClf, trainingDataFc, studyAreaGeo);
}


// 7) Generate annual Sentinel-2 composite and classify
print('Generating ' + year + ' Sentinel-2 SR composite...');
var sentinel2_SR_images = getSentinel2SRImage(startDate, cc, CSPLUS_CLEAR_THRESHOLD, CSPLUS_QA_BAND);

print('Classifying Sentinel-2 SR composite...');
var Sentinel2_SR_classified = null;
if (classNames.size().gt(0).getInfo()){
    Sentinel2_SR_classified = performSentinel2Classification(
                                'Sentinel2_SR',
                                classificationBands,
                                classNames,
                                cc,
                                sentinel2_SR_images
                              );
} else {
    print('Skip classification: training samples (classNames) undefined or empty.');
}


// 8) Export classification results
var exportFolder = 'Sentinel_SVM_Classification';
var yearString = ee.Number(year).format('%04d').getInfo();

if (Sentinel2_SR_classified) {
  var imageToExport = Sentinel2_SR_classified;
  var descriptionBase = yearString + '_Sentinel2_SR_CSPlus_Classification_ZXY';

  Export.image.toDrive({
    image: imageToExport.toByte(),
    description: descriptionBase,
    fileNamePrefix: descriptionBase,
    folder: exportFolder,
    region: cc.geometry(),
    scale: 10, 
    crs: 'EPSG:32649',
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });
  print('Export task created: ' + descriptionBase);
} else {
  print('No Sentinel-2 SR classification image available for year ' + yearString + ' to export.');
}