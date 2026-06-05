# outputs/

Local GeoTIFFs produced by the Python pipeline (when running with
`--output-mode local`). Contents are gitignored — these can be GBs.

The expected naming pattern is:
    {year}_{best_sensor}_Classification_SVM_Best.tif

with `EPSG:32649`, scale 30 m, dtype uint8, class codes 1–5.
