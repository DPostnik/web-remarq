import { Component } from 'react';

export class Counter extends Component<{}, { count: number }> {
  state = { count: 0 };
  render() {
    return <button onClick={() => this.setState({ count: this.state.count + 1 })}>Inc</button>;
  }
}
