"""Contrato do motor de transformação. Nenhum modelo é carregado por padrão.

Só habilite um adaptador depois de revisar licença comercial, origem dos pesos,
requisitos de GPU, política de uso e custo operacional.
"""
from dataclasses import dataclass

@dataclass
class EngineStatus:
    configured: bool
    name: str
    reason: str

class FaceSwapEngine:
    def status(self) -> EngineStatus:
        return EngineStatus(False, "disabled", "Nenhum modelo aprovado e configurado.")

    async def transform(self, source_bytes: bytes, target_bytes: bytes) -> bytes:
        raise RuntimeError("Motor de transformação não configurado.")

engine = FaceSwapEngine()
