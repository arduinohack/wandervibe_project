class PlanTemplate {
  final String id;
  final String name;
  final String description;

  const PlanTemplate({
    required this.id,
    required this.name,
    this.description = '',
  });

  factory PlanTemplate.fromJson(Map<String, dynamic> json) {
    final id = json['_id'] ?? json['id'];
    return PlanTemplate(
      id: id == null ? '' : id.toString(),
      name: (json['name'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
    );
  }
}
