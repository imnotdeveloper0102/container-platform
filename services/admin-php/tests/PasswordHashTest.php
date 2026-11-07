<?php

declare(strict_types=1);

namespace Admin\Tests;

use Admin\Auth;
use PHPUnit\Framework\TestCase;

final class PasswordHashTest extends TestCase
{
    public function testHashAndVerifyRoundTrip(): void
    {
        $hash = Auth::hashPassword('mat-khau-dung-123');
        $this->assertNotSame('mat-khau-dung-123', $hash);
        $this->assertTrue(Auth::verifyPassword('mat-khau-dung-123', $hash));
        $this->assertFalse(Auth::verifyPassword('mat-khau-sai', $hash));
    }

    public function testSamePasswordHashesDiffer(): void
    {
        $this->assertNotSame(Auth::hashPassword('lap-lai-123'), Auth::hashPassword('lap-lai-123'));
    }

    public function testEmptyPasswordDoesNotVerify(): void
    {
        $hash = Auth::hashPassword('mat-khau-dung-123');
        $this->assertFalse(Auth::verifyPassword('', $hash));
    }
}
