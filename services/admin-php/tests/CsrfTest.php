<?php

declare(strict_types=1);

namespace Admin\Tests;

use Admin\Csrf;
use PHPUnit\Framework\TestCase;

final class CsrfTest extends TestCase
{
    protected function setUp(): void
    {
        $_SESSION = [];
    }

    protected function tearDown(): void
    {
        $_SESSION = [];
    }

    public function testTokenValidates(): void
    {
        $token = Csrf::token();
        $this->assertTrue(Csrf::validate($token));
        $this->assertSame($token, Csrf::token(), 'Token phải ổn định trong cùng session');
    }

    public function testWrongTokenFails(): void
    {
        Csrf::token();
        $this->assertFalse(Csrf::validate('token-sai'));
        $this->assertFalse(Csrf::validate(null));
        $this->assertFalse(Csrf::validate(''));
    }
}
