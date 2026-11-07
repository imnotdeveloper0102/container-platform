<?php

declare(strict_types=1);

namespace Admin\Tests;

use Admin\Validation;
use PHPUnit\Framework\TestCase;

final class ValidationTest extends TestCase
{
    public function testValidUsername(): void
    {
        $this->assertNull(Validation::username('admin'));
        $this->assertNull(Validation::username('nguoi-quan-tri_1'));
    }

    public function testInvalidUsername(): void
    {
        $this->assertNotNull(Validation::username(''));
        $this->assertNotNull(Validation::username('ab'));
        $this->assertNotNull(Validation::username('co dau cach'));
        $this->assertNotNull(Validation::username('user/name'));
    }

    public function testPasswordMinimumLength(): void
    {
        $this->assertNotNull(Validation::password('ngan'));
        $this->assertNull(Validation::password('du-dai-123'));
    }

    public function testRole(): void
    {
        $this->assertNull(Validation::role('admin'));
        $this->assertNull(Validation::role('operator'));
        $this->assertNull(Validation::role('viewer'));
        $this->assertNotNull(Validation::role('superuser'));
    }

    public function testRuleValueAcceptsInRangeIntegers(): void
    {
        $this->assertSame(5, Validation::ruleValue('BRUTE_FORCE_THRESHOLD', '5'));
        $this->assertSame(0, Validation::ruleValue('ALERT_COOLDOWN_SECONDS', '0'));
        $this->assertSame(604800, Validation::ruleValue('ALERT_COOLDOWN_SECONDS', '604800'));
    }

    public function testRuleValueRejectsOutOfRangeAndNonNumeric(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Validation::ruleValue('BRUTE_FORCE_THRESHOLD', '0');
    }

    public function testRuleValueRejectsUnknownKey(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Validation::ruleValue('KHONG_CO_LUAT_NAY', '5');
    }

    public function testSettingKey(): void
    {
        $this->assertNull(Validation::settingKey('site.title'));
        $this->assertNull(Validation::settingKey('alerts.page_size'));
        $this->assertNotNull(Validation::settingKey(''));
        $this->assertNotNull(Validation::settingKey('Co Hoa'));
        $this->assertNotNull(Validation::settingKey('key co dau cach'));
    }

    public function testIdParsing(): void
    {
        $this->assertSame(42, Validation::id('42'));
        $this->assertNull(Validation::id('0'));
        $this->assertNull(Validation::id('-1'));
        $this->assertNull(Validation::id('abc'));
    }
}
