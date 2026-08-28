@echo off
REM Instala o que o bot precisa para funcionar. Rode UMA vez (duplo clique).
echo ============================================
echo   Instalando o bot de ofertas...
echo ============================================
py -m pip install -r requirements.txt
echo.
echo ============================================
echo   Pronto! Agora preencha o arquivo .env
echo   e use o "2-testar.bat".
echo ============================================
pause
