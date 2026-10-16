// A controller for a real person. It is given a `prompt` function so the
// engine stays I/O-free: the CLI passes a readline-based prompt, a web UI
// would pass one that resolves when the user taps a button.

export class HumanController {
  constructor(prompt) {
    this.prompt = prompt; // async (question, options) => index of chosen option
  }

  async decide({ player, actions }) {
    const index = await this.prompt(
      `Your move (you have ${player.chips} chips):`,
      actions.map((a) => a.label)
    );
    return actions[index];
  }
}
