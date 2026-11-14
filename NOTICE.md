# Third-party notices

This project is released under the MIT license (see [LICENSE](LICENSE)). The following material is
used with its own terms and is **not** relicensed by the MIT license.

## Telemetry data

- Source: NASA SMAP spacecraft telemetry, distributed with the **Telemanom** dataset.
- Reference: Hundman, K., Constantinou, V., Laporte, C., Colwell, I., Soderstrom, T.
  *Detecting Spacecraft Anomalies Using LSTMs and Nonparametric Dynamic Thresholding.* KDD 2018.
- License: BSD-3-Clause, as distributed in the Telemanom repository.
  <https://github.com/khundman/telemanom>
- Anomaly labels: NASA JPL engineers, as published in `labeled_anomalies.csv`.
- Mirror used for training and export: <https://huggingface.co/datasets/appleparan/telemanom>.

## 3D backdrop

- Model: *Solar System* by **pinotoon** on Sketchfab.
- License: **Sketchfab Editorial**. Attribution is displayed in the dashboard footer and README.
- Embedded with the `dnt=1` (do not track) parameter.
- <https://sketchfab.com/3d-models/solar-system-178d1deb210a4bc4a63ee05bc6cb6dcf>
- The model must be replaced before any commercial use of this project.

## Software dependencies

- Python: FastAPI, NumPy, Uvicorn, and the training-only stack (TensorFlow, scikit-learn, pandas,
  pyarrow, joblib). Each package retains its own license; see `backend/requirements.txt` and the
  training instructions in the README.
- JavaScript: React, Vite, Tailwind CSS, Recharts, and their transitive dependencies. Each package
  retains its own license; see `frontend/package.json`.

## Fonts and assets

- No web fonts are loaded. The interface uses the operating system's sans-serif and monospace
  stacks.
- The dashboard favicon is an original SVG created for this project.
