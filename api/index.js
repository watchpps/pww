export const config = {
  runtime: 'edge', // 强制启动 Edge 运行时，支持无限流式媒体传输，无 10 秒超时限制
};

export default async function handler(request) {
  const url = new URL(request.url);
  
  // 1. 处理跨域预检
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  // 2. 提取并还原目标 IPTV 链接
  let targetUrlStr = url.pathname.slice(1) + url.search;
  
  if (targetUrlStr.startsWith("https:/") && !targetUrlStr.startsWith("https://")) {
    targetUrlStr = targetUrlStr.replace("https:/", "https://");
  }
  if (targetUrlStr.startsWith("http:/") && !targetUrlStr.startsWith("http://")) {
    targetUrlStr = targetUrlStr.replace("http:/", "http://");
  }

  if (!targetUrlStr || !targetUrlStr.startsWith("http")) {
    return new Response("Vercel Edge Proxy: Invalid Target URL", { status: 400 });
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    
    // 3. 彻底洗净头部，伪装成纯净的普通电脑浏览器
    const cleanHeaders = new Headers();
    cleanHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    cleanHeaders.set("Accept", "*/*");
    cleanHeaders.set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");

    // 4. 使用 AWS 节点 IP 向源站发起请求
    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: cleanHeaders,
      redirect: "follow"
    });

    // 5. 配置允许跨域传给播放器
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "*");

    const contentType = response.headers.get("content-type") || "";
    const isM3U8 = targetUrlStr.includes(".m3u8") || contentType.includes("mpegurl");
    const isMPD = targetUrlStr.includes(".mpd") || contentType.includes("dash+xml");

    // 6. 如果是 M3U8 或 MPD 索引列表，在线重写后续切片的路径
    if (isM3U8 || isMPD) {
      let text = await response.text();
      const originalOrigin = targetUrl.origin; 
      const proxyPrefix = url.origin + "/" + originalOrigin; 
      
      // 将里面的绝对路径强行替换，让后续所有视频切片同样通过 Vercel 中转
      text = text.replaceAll(originalOrigin, proxyPrefix);
      
      if (isMPD) {
        newHeaders.set("content-type", "application/dash+xml;charset=UTF-8");
      }

      return new Response(text, { status: response.status, headers: newHeaders });
    }

    // 7. 二进制视频流（.ts / .m4s）直接通过管道无缝流式返回
    return new Response(response.body, { status: response.status, headers: newHeaders });

  } catch (err) {
    return new Response(`Vercel Proxy Error: ${err.message}`, { status: 500 });
  }
}
