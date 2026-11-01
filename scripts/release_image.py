"""Inspect exact local identities before attempting an unauthenticated API pull."""

import re


class EngineError(RuntimeError):
    def __init__(self, method, path, status):
        super().__init__(method, path, status)
        self.status = status


def ensure_image(engine, image):
    pinned = re.fullmatch(r'.+@sha256:[a-f0-9]{64}', image)
    path = '/images/' + image + '/json'
    try:
        info = engine('GET', path)
    except EngineError as e:
        if e.status != 404 or not pinned:
            raise
        engine('POST', '/images/create?fromImage=' + image)
        info = engine('GET', path)
    if pinned and image not in info.get('RepoDigests', []):
        raise RuntimeError('Local image does not record the requested registry digest')
    return info
