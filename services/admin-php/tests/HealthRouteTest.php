<?php

declare(strict_types=1);

namespace Admin\Tests;

use Admin\AdminApp;
use Admin\Config;
use Admin\JsonLogger;
use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

final class HealthRouteTest extends TestCase
{
    private function app(): \Slim\App
    {
        // Không có PDO: /healthz vẫn 200, /readyz phải 503.
        return AdminApp::create(new Config([]), null, new JsonLogger('error'));
    }

    public function testHealthzReturnsOkWithoutDatabase(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/healthz');
        $response = $this->app()->handle($request);
        $this->assertSame(200, $response->getStatusCode());
        $body = (string) $response->getBody();
        $this->assertStringContainsString('"status":"ok"', $body);
    }

    public function testReadyzReturns503WithoutDatabase(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/readyz');
        $response = $this->app()->handle($request);
        $this->assertSame(503, $response->getStatusCode());
        $body = (string) $response->getBody();
        $this->assertStringContainsString('not_ready', $body);
    }
}
