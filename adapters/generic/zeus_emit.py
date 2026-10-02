#!/usr/bin/env python3
"""Pipe normalized JSON into Zeus: echo '{...}' | zeus_emit.py"""
import pathlib
import sys
COMMON = pathlib.Path(__file__).resolve().parents[1] / "common"
sys.path.insert(0, str(COMMON))
from zeus_adapter import emit, read_stdin_json  # noqa:E402

body = read_stdin_json()
if body:
    emit(body)
