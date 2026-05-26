#!/bin/bash
for f in *.yaml ; do
  python ../fetch_gnome_bugzilla_static.py --profile $f --out ../../../data/gimp/raw/_contributions_${f%.yaml}_bugzilla.csv
done
