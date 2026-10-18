package com.cyberhub.manager;
import java.io.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import com.android.apksig.*;

/** Publishes an APK only after all requested signature schemes verify. */
public final class ApkSigning {
 private ApkSigning() {}
 public static void sign(File source, File destination, InputStream keyStream) throws Exception {
  if(destination.exists())throw new IOException("签名输出已存在");
  File parent=destination.getAbsoluteFile().getParentFile();
  File temporary=File.createTempFile(".verified-sign-",".apk",parent);
  try {
   KeyStore store=KeyStore.getInstance("PKCS12");char[] password="cyberhub-development".toCharArray();store.load(keyStream,password);
   String alias=store.aliases().nextElement();
   ApkSigner.SignerConfig signer=new ApkSigner.SignerConfig.Builder("CyberHubDevelopment",(PrivateKey)store.getKey(alias,password),Collections.singletonList((X509Certificate)store.getCertificate(alias))).build();
   new ApkSigner.Builder(Collections.singletonList(signer)).setInputApk(source).setOutputApk(temporary).setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(true).setMinSdkVersion(21).build().sign();
   ApkVerifier.Result result=new ApkVerifier.Builder(temporary).setMinCheckedPlatformVersion(21).build().verify();
   if(!result.isVerified()||!result.isVerifiedUsingV1Scheme()||!result.isVerifiedUsingV2Scheme()||!result.isVerifiedUsingV3Scheme())throw new IOException("APK 签名校验失败："+result.getErrors());
   if(destination.exists())throw new IOException("输出由另一个操作创建");
   FileOps.replace(temporary,destination);
  }finally{temporary.delete();}
 }
}
