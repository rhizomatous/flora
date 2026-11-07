"""Refuse publication unless GitHub confirms this tag has no release yet."""

import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def require_unpublished(repository, tag, token, api_url='https://api.github.com'):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository')
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?', tag):
        raise ValueError('Invalid release tag')
    if not token:
        raise ValueError('GitHub authentication is required')
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28'}

    def get(path):
        req = urllib.request.Request(api_url + '/repos/' + repository + path, headers=headers)
        # Do not forward the publishing credential through redirects.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
                if response.status != 200:
                    raise RuntimeError('Unexpected GitHub API response')
        except urllib.error.HTTPError as e:
            e.close()
            raise

    # A repository-level 404 must not be mistaken for an unused release tag.
    get('')
    try:
        get('/releases/tags/' + urllib.parse.quote(tag, safe=''))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return
        raise
    raise RuntimeError('This tag already has a release; refusing to overwrite its image')


if __name__ == '__main__':
    try:
        require_unpublished(sys.argv[1], sys.argv[2], os.environ.get('GH_TOKEN', ''))
    except Exception:
        # API response bodies and authentication headers never belong in logs.
        sys.exit('Release preflight failed: existing release, invalid tag, or GitHub access unavailable. No image may be pushed.')
