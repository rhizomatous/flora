"use client";

// Adapted from https://github.com/shadcn-ui/ui/blob/main/apps/v4/examples/radix/card-rtl.tsx

import { useState } from "react";

import { DirectionProvider, NativeSelect, NativeSelectOption } from "@flora/florets";
import { Button } from "@flora/florets/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@flora/florets/components/card";
import { Input } from "@flora/florets/components/input";
import { Label } from "@flora/florets/components/label";

import { Example, ExampleWrapper } from "../example";

const translations = {
  en: {
    dir: "ltr",
    values: {
      title: "Login to your account",
      description: "Enter your email below to login to your account",
      signUp: "Sign Up",
      email: "Email",
      emailPlaceholder: "m@example.com",
      password: "Password",
      forgotPassword: "Forgot your password?",
      login: "Login",
      loginWithGoogle: "Login with Google",
    },
  },
  ar: {
    dir: "rtl",
    values: {
      title: "تسجيل الدخول إلى حسابك",
      description: "أدخل بريدك الإلكتروني أدناه لتسجيل الدخول إلى حسابك",
      signUp: "إنشاء حساب",
      email: "البريد الإلكتروني",
      emailPlaceholder: "m@example.com",
      password: "كلمة المرور",
      forgotPassword: "نسيت كلمة المرور؟",
      login: "تسجيل الدخول",
      loginWithGoogle: "تسجيل الدخول باستخدام Google",
    },
  },
  he: {
    dir: "rtl",
    values: {
      title: "התחבר לחשבון שלך",
      description: "הזן את האימייל שלך למטה כדי להתחבר לחשבון שלך",
      signUp: "הירשם",
      email: "אימייל",
      emailPlaceholder: "m@example.com",
      password: "סיסמה",
      forgotPassword: "שכחת את הסיסמה?",
      login: "התחבר",
      loginWithGoogle: "התחבר עם Google",
    },
  },
};

export function Preview() {
  const [language, setLanguage] = useState<keyof typeof translations>("ar");
  const { dir, values: t } = translations[language];

  return (
    <ExampleWrapper className="md:grid-cols-1">
      <Example title="Direction">
        <Label htmlFor="direction-language">Language</Label>
        <NativeSelect
          id="direction-language"
          value={language}
          onChange={(event) => {
            const { value } = event.target;
            if (value === "en" || value === "ar" || value === "he") setLanguage(value);
          }}
        >
          <NativeSelectOption value="ar">Arabic (العربية)</NativeSelectOption>
          <NativeSelectOption value="he">Hebrew (עברית)</NativeSelectOption>
          <NativeSelectOption value="en">English</NativeSelectOption>
        </NativeSelect>
        <DirectionProvider direction={dir === "rtl" ? "rtl" : "ltr"}>
          <Card className="w-full max-w-sm" dir={dir}>
            <CardHeader>
              <CardTitle>{t.title}</CardTitle>
              <CardDescription>{t.description}</CardDescription>
              <CardAction>
                <Button variant="link">{t.signUp}</Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <form>
                <div className="flex flex-col gap-6">
                  <div className="grid gap-2">
                    <Label htmlFor="email-rtl">{t.email}</Label>
                    <Input id="email-rtl" type="email" placeholder={t.emailPlaceholder} required />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center">
                      <Label htmlFor="password-rtl">{t.password}</Label>
                      <a
                        href="#password-rtl"
                        className="ms-auto inline-block text-sm underline-offset-4 hover:underline"
                      >
                        {t.forgotPassword}
                      </a>
                    </div>
                    <Input id="password-rtl" type="password" required />
                  </div>
                </div>
              </form>
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button type="submit" className="w-full">
                {t.login}
              </Button>
              <Button variant="outline" className="w-full">
                {t.loginWithGoogle}
              </Button>
            </CardFooter>
          </Card>
        </DirectionProvider>
      </Example>
    </ExampleWrapper>
  );
}
