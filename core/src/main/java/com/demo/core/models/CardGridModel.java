package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CardGridModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ValueMapValue
    @Default(values = "icon-cards")
    private String style;

    @ChildResource
    private List<CardGridItemModel> items;

    private List<CardGridItemModel> filteredItems;

    @PostConstruct
    void init() {
        filteredItems = new ArrayList<>();
        if (items != null) {
            for (CardGridItemModel item : items) {
                if (item != null && item.isHasContent()) {
                    filteredItems.add(item);
                }
            }
        }
    }

    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getStyle() { return style; }
    public List<CardGridItemModel> getItems() { return Collections.unmodifiableList(filteredItems); }
    public boolean isHasContent() { return title != null || description != null || !filteredItems.isEmpty(); }
}
