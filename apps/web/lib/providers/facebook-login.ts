import type { OAuthConfig } from "next-auth/providers";
import { FB_API_VERSION } from "@fb-ads/shared";

interface FacebookProfile {
  id: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string } };
}

export function FacebookLoginProvider(options: {
  clientId: string;
  clientSecret: string;
  configId?: string;
}): OAuthConfig<FacebookProfile> {
  const { clientId, clientSecret, configId } = options;

  return {
    id: "facebook",
    name: "Facebook",
    type: "oauth",
    checks: ["state"],
    clientId,
    clientSecret,
    authorization: {
      url: `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`,
      // Must set scope explicitly — Auth.js auto-adds "openid profile email" if missing
      params: configId
        ? { config_id: configId, scope: "public_profile" }
        : { scope: "public_profile" },
    },
    token: {
      url: `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`,
    },
    userinfo: `https://graph.facebook.com/${FB_API_VERSION}/me?fields=id,name,email,picture`,
    profile(profile) {
      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        image: profile.picture?.data?.url,
      };
    },
  };
}
