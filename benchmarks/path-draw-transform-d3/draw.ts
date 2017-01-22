﻿declare const require: Function
const d3 = require('d3')

interface IChartData {
	name: string
	values: number[]
}

interface IChartParameters {
	x: Function
	y: Function
	rx: Function
	ry: Function
	view: any
	data: IChartData[]
	height: number
	line: Function
	color: Function
}

function drawProc(f: any) {
	let requested = false

	return function (...params: any[]) {
		if (!requested) {
			requested = true
			d3.timeout(function (time: any) {
				requested = false
				f(params)
			})
		}
	}
}

export class TimeSeriesChart {
	private chart: IChartParameters
	private minX: Date
	private maxX: Date
	private missedStepsCount: number
	private stepX: number

	constructor(svg: any, minX: Date, stepX: number, data: any[]) {
		this.stepX = stepX
		this.minX = minX
		this.maxX = this.calcDate(data.length - 1, minX)

		this.drawChart(svg, data)

		this.missedStepsCount = 0
	}

	public zoom = drawProc(function (param: any[]) {
		const translateX = param[0]
		const translateY = param[1]
		const scaleX = param[2]
		const scaleY = param[3]
		this.chart.view.attr('transform', `translate(${translateX},${translateY}) scale(${scaleX},${scaleY})`)
	}.bind(this))

	private drawChart(svg: any, data: any[]) {
		const width = svg.node().parentNode.clientWidth,
			height = svg.node().parentNode.clientHeight
		svg.attr('width', width)
		svg.attr('height', height)

		const x = d3.scaleTime().range([0, width])
		const y = d3.scaleLinear().range([height, 0])
		const color = d3.scaleOrdinal().domain(['NY', 'SF']).range(['green', 'blue'])
		
		const line = d3.line()
			.defined((d: number) => d)
			.x((d: number, i: number) => x(this.calcDate(i, this.minX)))
			.y((d: number) => y(d))

		const cities = color.domain()
			.map((name: string) => {
				return ({
					name: name,
					values: data.map((d: any) => +d[name])
				})
			})

		x.domain([this.minX, this.maxX])
		y.domain([5, 85])

		const view = svg.append('g')
			.selectAll('.view')
			.data(cities)
			.enter().append('g')
			.attr('class', 'view')

		view.append('path')
			.attr('d', (d: any) => line(d.values))
			.attr('stroke', (d: any) => color(d.name))

		svg.append('rect')
			.attr('class', 'zoom')
			.attr('width', width)
			.attr('height', height)
			.call(d3.zoom()
				.scaleExtent([1, 40])
				.translateExtent([[0, 0], [width, height]]))

		this.chart = {
			x: x, y: y, rx: x.copy(), ry: y.copy(),
			view: view, data: cities, height: height, line: line, color: color
		}
	}

	private getZoomIntervalY(xSubInterval: [Date, Date], intervalSize: number): [number, number] {
		let from = intervalSize
		let to = 0
		for (let i = 0; i < intervalSize; i++) {
			if (this.calcDate(i, this.minX) >= xSubInterval[0] && this.calcDate(i, this.minX) <= xSubInterval[1]) {
				if (i > to) to = i
				if (i < from) from = i
			}
		}
		return [from, to]
	}

	private calcDate(index: number, offset: Date) {
		return new Date(index * this.stepX + offset.getTime())
	}
}