"use client";

import Script from "next/script";
import { useEffect } from "react";
import {
  FB_API_VERSION,
  FB_SDK_URL,
  getFacebookAppId,
  isFacebookSdkConfigured,
} from "@/lib/facebook/sdk";

type FacebookSdkProps = {
  onReady?: () => void;
};

export function FacebookSdk({ onReady }: FacebookSdkProps) {
  const appId = getFacebookAppId();

  useEffect(() => {
    if (!isFacebookSdkConfigured()) return;

    window.fbAsyncInit = function () {
      window.FB?.init({
        appId,
        cookie: true,
        xfbml: true,
        version: FB_API_VERSION,
      });

      window.FB?.AppEvents.logPageView();
      onReady?.();
    };

    if (window.FB) {
      onReady?.();
    }
  }, [appId, onReady]);

  if (!isFacebookSdkConfigured()) {
    return null;
  }

  return (
    <Script
      id="facebook-jssdk"
      src={FB_SDK_URL}
      strategy="afterInteractive"
      async
      defer
      crossOrigin="anonymous"
    />
  );
}
