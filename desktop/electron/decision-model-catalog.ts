import { LAYA_RUNTIME_PACKAGE } from './decision-model-runtime-pins.js';
import type { DecisionModelManifest } from '../shared/decision-model-types.js';
// Frozen public Hugging Face revision and blob metadata, audited 2026-10-06. Never follows main.
export const DECISION_MODEL_CATALOG: readonly DecisionModelManifest[] = [
    {
        "id": "clef-flash-mlx-4bit",
        "repo": "mlx-community/clef-flash-4bit",
        "revision": "140bf7e037f5fa95a96535feca112f46c15927cf",
        "runtime": "clef-mlx",
        "platforms": [
            "darwin-arm64"
        ],
        "files": [
            {
                "name": "LICENSE",
                "size": 11544,
                "hash": "f938136e3adacfd92be087f6e113b5d6d97f678f",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "chat_template.jinja",
                "size": 7756,
                "hash": "a585dec894e63da457d9440ec6aa7caa16d20860",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "clef_mlx.py",
                "size": 33670,
                "hash": "6fff06cf36df69eafeeca0f64f2cf80fa16e2025",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "config.json",
                "size": 3722,
                "hash": "8118c27cba9d5b2eb8e9d1dbcbe581cd38cfc7af",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "generation_config.json",
                "size": 116,
                "hash": "54056568766c020050fab57761fea673becbc131",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "joint_head.safetensors",
                "size": 243538016,
                "hash": "19cdcec8c81dc9212be320fff47462ab342fbc1278be4368fb3da71241cf5ba0",
                "algorithm": "sha256"
            },
            {
                "name": "joint_head_config.json",
                "size": 119,
                "hash": "52467b6c7f7d1a7e628b518eb7a6cd7e9bdb9a57",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "model-00001-of-00002.safetensors",
                "size": 5349769710,
                "hash": "39894f085d844004c8e5c2394e45b5ab66bce4637ecdf23d92bf7c85cb66238f",
                "algorithm": "sha256"
            },
            {
                "name": "model-00002-of-00002.safetensors",
                "size": 600449850,
                "hash": "40258d3d4f7225a0acbb45f4d34693465b98c8e2c0a4b0a512e536750379fcf3",
                "algorithm": "sha256"
            },
            {
                "name": "model.safetensors.index.json",
                "size": 123592,
                "hash": "b1846cf03478ee8111d3a7cd5dd2bd685237cce3",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "processor_config.json",
                "size": 1191,
                "hash": "33818c7f9e991ad735fd240209f4fa73e6c28c50",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "tokenizer.json",
                "size": 19989339,
                "hash": "a5cd9732badce41de57e6efce8302930ded1c1188c5f81feb2bd6c24c4a1941f",
                "algorithm": "sha256"
            },
            {
                "name": "tokenizer_config.json",
                "size": 1190,
                "hash": "848c7c7ff98e31b321d5c2279befd857f269e861",
                "algorithm": "git-blob-sha1"
            }
        ],
        "sizeBytes": 6213929815,
        "source": "https://huggingface.co/mlx-community/clef-flash-4bit",
        "codeHash": "852223c944819a32fad5cf798d9d1dff30419820eaf5ad1f10cb9698afec97d5"
    },
    {
        "id": "laya-multilingual",
        "repo": "convaiinnovations/laya-multilingual",
        "revision": "1720e3e3357cfe1e281542e223f8273b0890ca34",
        "runtime": "laya",
        "platforms": [
            "darwin-arm64",
            "win32-x64"
        ],
        "files": [
            {
                "name": "config.json",
                "size": 160,
                "hash": "7b4305a11f6d6936882e99492abe8e34d8ae6e3a",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "encoder/config.json",
                "size": 1938,
                "hash": "0de0e2d30638873790cf962def52e2acf4db3eef",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "model.safetensors",
                "size": 643835514,
                "hash": "9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204",
                "algorithm": "sha256"
            },
            {
                "name": "rl_agent_config.json",
                "size": 472,
                "hash": "00e35f88bb731bb9126a914666ab1cdac8a204c8",
                "algorithm": "git-blob-sha1"
            },
            {
                "name": "tokenizer/tokenizer.json",
                "size": 34363188,
                "hash": "609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f",
                "algorithm": "sha256"
            },
            {
                "name": "tokenizer/tokenizer_config.json",
                "size": 502,
                "hash": "eea1ed61121530d74c1722dc2aab6ec917a75909",
                "algorithm": "git-blob-sha1"
            }
        ],
        "sizeBytes": 678201774,
        "source": "https://huggingface.co/convaiinnovations/laya-multilingual",
        "codeHash": LAYA_RUNTIME_PACKAGE.wheelSha256,
        runtimePackage: LAYA_RUNTIME_PACKAGE
    }
];
