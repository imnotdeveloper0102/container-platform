<?php

declare(strict_types=1);

namespace Admin;

/** Render template PHP thuần, mọi biến hiển thị đều phải qua $e() (escape). */
final class View
{
    public function __construct(private readonly string $templatesDir)
    {
    }

    public function render(string $template, array $data = []): string
    {
        $data['e'] = static fn(mixed $value): string => htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
        extract($data, EXTR_SKIP);
        ob_start();
        require $this->templatesDir . '/' . $template;
        $out = ob_get_clean();
        return $out === false ? '' : $out;
    }

    /** Lấy flash message trong session rồi xóa (hiển thị một lần). */
    public static function takeFlash(): ?array
    {
        $flash = $_SESSION['flash'] ?? null;
        unset($_SESSION['flash']);
        return is_array($flash) && isset($flash['type'], $flash['msg']) ? $flash : null;
    }

    public static function setFlash(string $type, string $msg): void
    {
        $_SESSION['flash'] = ['type' => $type, 'msg' => $msg];
    }
}
