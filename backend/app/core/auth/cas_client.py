"""SUSTech CAS认证客户端"""
from typing import Optional

import httpx

from app.blackboard.shared.logging import BlackboardLogger


class CASClient:
    """CAS认证客户端，用于SUSTech统一身份认证"""

    def __init__(self, logger: BlackboardLogger | None = None):
        self.logger = logger
        self.cas_login_url = "https://cas.sustech.edu.cn/cas/login"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1"
        }
        self.client = httpx.Client(follow_redirects=True, timeout=30.0, headers=headers)
    
    def login(self, username: str, password: str, service_url: str) -> bool:
        """
        执行CAS登录
        
        Args:
            username: 学号/工号
            password: 密码
            service_url: 目标服务URL（如Blackboard）
            
        Returns:
            是否登录成功
        """
        # 1. 访问CAS登录页面获取execution token
        params = {"service": service_url}
        response = self.client.get(self.cas_login_url, params=params)
        
        # 2. 从HTML中提取execution token
        execution = self._extract_execution(response.text)
        if not execution:
            if self.logger is not None:
                self.logger.error(
                    "❌ 无法获取 execution token",
                    payload={"service_url": service_url},
                )
            return False
            
        # 3. 提交登录表单
        login_data = {
            "username": username,
            "password": password,
            "execution": execution,
            "_eventId": "submit",
            "geolocation": "",
            "submit": "登录"
        }
        
        response = self.client.post(
            self.cas_login_url,
            params=params,
            data=login_data
        )
        
        # 4. 检查是否登录成功（通过检查是否重定向到目标服务）
        # 如果成功，通常会重定向到目标服务域名
        from urllib.parse import urlparse
        service_domain = urlparse(service_url).netloc
        success = service_domain in str(response.url)
        
        if self.logger is not None:
            if success:
                self.logger.info("✅ CAS 登录成功", payload={"redirect_url": str(response.url)})
            else:
                self.logger.warning("❌ CAS 登录失败", payload={"final_url": str(response.url)})

        return success
    
    def _extract_execution(self, html: str) -> Optional[str]:
        """从CAS登录页面提取execution token"""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        execution_input = soup.find('input', {'name': 'execution'})
        if execution_input and isinstance(execution_input.get('value'), str):
            return str(execution_input['value'])
        return None
    
    def get_cookies(self) -> dict[str, str]:
        """获取当前session的cookies"""
        return dict(self.client.cookies)
    
    def close(self) -> None:
        """关闭HTTP客户端"""
        self.client.close()
