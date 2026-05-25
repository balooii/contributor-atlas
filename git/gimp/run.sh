#!/bin/bash
for f in *.yaml ; do
  profile_stem=${f%.yaml}
  echo "== $profile_stem =="
  python ../classify_commits.py --profile $f --out ../../data/gimp/_contributions_${profile_stem}_git.csv
done
