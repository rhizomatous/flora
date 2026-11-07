import http.server
import threading
import unittest
import urllib.error

from release_guard import require_unpublished
from release_image import EngineError, ensure_image


class ReleaseGuardTest(unittest.TestCase):
    def run_guard(self, statuses, tag='v1.2.3'):
        requests = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(statuses[len(requests) - 1])
                self.send_header('Location', '/must-not-follow')
                self.end_headers()

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01})
        thread.start()
        try:
            require_unpublished('owner/repo', tag, 'fixture-token',
                                f'http://127.0.0.1:{server.server_port}')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
            self.assertLessEqual(len(requests), 2)

    def test_only_release_404_permits_first_publication(self):
        self.run_guard([200, 404])

    def test_alpha_tag_is_accepted_but_existing_release_is_not(self):
        self.run_guard([200, 404], 'v0.0.1-alpha.1')
        with self.assertRaisesRegex(RuntimeError, 'already has a release'):
            self.run_guard([200, 200], 'v0.0.1-alpha.1')

    def test_existing_release_blocks_rerun(self):
        with self.assertRaisesRegex(RuntimeError, 'already has a release'):
            self.run_guard([200, 200])

    def test_errors_and_redirects_fail_closed(self):
        for statuses in ([401], [403], [404], [500], [200, 401], [200, 403],
                         [200, 429], [200, 503], [200, 302], [200, 204]):
            with self.subTest(statuses=statuses), self.assertRaises((urllib.error.HTTPError, RuntimeError)):
                self.run_guard(statuses)

    def test_connection_failure_blocks_publication(self):
        with self.assertRaises(urllib.error.URLError):
            require_unpublished('owner/repo', 'v1.2.3', 'fixture-token', 'http://127.0.0.1:0')

    def test_invalid_input_never_calls_api(self):
        for repo, tag, token in [('owner/repo', 'latest', 'fixture'),
                                 ('owner/../repo', 'v1.2.3', 'fixture'),
                                 ('owner/repo', 'v1.2.3', '')]:
            with self.subTest(repo=repo, tag=tag), self.assertRaises(ValueError):
                require_unpublished(repo, tag, token)


class ImageIdentityTest(unittest.TestCase):
    pin = 'ghcr.io/owner/agent@sha256:' + 'a' * 64

    def test_prepulled_private_image_needs_no_engine_auth(self):
        calls = []

        def engine(method, path):
            calls.append((method, path))
            self.assertEqual(method, 'GET', 'pre-pulled image must never be pulled again')
            return {'Id': 'immutable-content-id', 'RepoDigests': [self.pin]}

        self.assertEqual(ensure_image(engine, self.pin)['Id'], 'immutable-content-id')
        self.assertEqual(calls, [('GET', '/images/' + self.pin + '/json')])

    def test_missing_pin_is_pulled_without_changing_identity(self):
        calls = []

        def engine(method, path):
            calls.append((method, path))
            if len(calls) == 1:
                raise EngineError(method, path, 404)
            return {'RepoDigests': [self.pin]}

        ensure_image(engine, self.pin)
        self.assertEqual(calls, [('GET', '/images/' + self.pin + '/json'),
                                 ('POST', '/images/create?fromImage=' + self.pin),
                                 ('GET', '/images/' + self.pin + '/json')])

    def test_wrong_local_digest_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'requested registry digest'):
            ensure_image(lambda *_: {'RepoDigests': [self.pin + 'wrong']}, self.pin)

    def test_inspection_error_or_missing_mutable_tag_never_pulls(self):
        for image, status in [(self.pin, 401), (self.pin, 500), ('agent:mutable', 404)]:
            calls = []

            def engine(method, path):
                calls.append(method)
                raise EngineError(method, path, status)

            with self.subTest(image=image, status=status), self.assertRaises(EngineError):
                ensure_image(engine, image)
            self.assertEqual(calls, ['GET'])


if __name__ == '__main__':
    unittest.main()
