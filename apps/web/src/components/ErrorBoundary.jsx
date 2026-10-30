import { Component } from 'react';
export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if(this.state.failed)return <main className="wrap"><p className="alert" role="alert">This page could not load. Check your connection and try again.</p><button className="btn" onClick={()=>window.location.reload()}>Reload page</button></main>;
    return this.props.children;
  }
}
