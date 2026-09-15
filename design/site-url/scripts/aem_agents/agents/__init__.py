"""Agent implementations."""

from .base import Agent, RunContext
from .component import ComponentAgent
from .deployer import DeployerAgent
from .parity import ParityAgent
from .planner import PlannerAgent

AGENT_CLASSES: dict[str, type[Agent]] = {
    PlannerAgent.agent_id: PlannerAgent,
    ComponentAgent.agent_id: ComponentAgent,
    DeployerAgent.agent_id: DeployerAgent,
    ParityAgent.agent_id: ParityAgent,
}

__all__ = [
    "AGENT_CLASSES",
    "Agent",
    "ComponentAgent",
    "DeployerAgent",
    "ParityAgent",
    "PlannerAgent",
    "RunContext",
]
